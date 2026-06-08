import type {
  AgentDecision,
  EvaluationCriterion,
  EvaluationCriterionResult,
  EvaluationResult,
  StepEvaluationResult,
  TaskEvent,
  TaskInput,
  ToolResult
} from "./schemas.js";

export class DeterministicEvaluator {
  evaluateStep(task: TaskInput, decision: AgentDecision, result: ToolResult, _events: TaskEvent[]): StepEvaluationResult {
    const withQualityFloor = (evaluation: StepEvaluationResult): StepEvaluationResult => {
      if (evaluation.gate === "stop" || evaluation.score >= task.quality.minStepScore) {
        return evaluation;
      }

      return {
        ...evaluation,
        pass: false,
        gate: "continue",
        feedback: `${evaluation.feedback} Quality floor not met: score ${evaluation.score} is below ${task.quality.minStepScore}.`
      };
    };

    if (!result.ok) {
      const error = result.error ?? "Tool returned an error.";
      if (
        error.includes("Path escapes workspace") ||
        error.includes("Only the configured test command is allowed") ||
        error.includes("Only the configured typecheck command is allowed")
      ) {
        return {
          pass: false,
          score: 0,
          gate: "stop",
          feedback: `Loop stopped because the proposed action violated a policy boundary: ${error}`
        };
      }

      return withQualityFloor({
        pass: false,
        score: 0.25,
        gate: "continue",
        feedback: `Tool failed; use the error as feedback before choosing the next action: ${error}`
      });
    }

    if (result.tool === "repo.run_tests") {
      const output = result.output as { passed?: boolean } | undefined;
      if (output?.passed === true) {
        return withQualityFloor({
          pass: true,
          score: 1,
          gate: "continue",
          feedback: "Configured tests passed. The loop can now produce a final answer."
        });
      }

      return withQualityFloor({
        pass: false,
        score: 0.45,
        gate: "continue",
        feedback: "Configured tests did not pass yet. Continue discovery, patching, or verification."
      });
    }

    if (result.tool === "repo.run_typecheck") {
      const output = result.output as { passed?: boolean } | undefined;
      if (output?.passed === true) {
        return withQualityFloor({
          pass: true,
          score: 1,
          gate: "continue",
          feedback: "Configured typecheck passed. The loop has independent type-error evidence."
        });
      }

      return withQualityFloor({
        pass: false,
        score: 0.4,
        gate: "continue",
        feedback: "Configured typecheck did not pass yet. Fix type errors before finalizing."
      });
    }

    if (result.tool === "repo.apply_patch") {
      return withQualityFloor({
        pass: true,
        score: decision.risk === "high" ? 0.6 : 0.75,
        gate: "continue",
        feedback: "Patch applied. The next loop step should verify it with the configured test command or inspect the diff."
      });
    }

    return withQualityFloor({
      pass: true,
      score: 0.65,
      gate: "continue",
      feedback: "Step produced usable evidence for the next loop iteration."
    });
  }

  evaluateFinal(task: TaskInput, decision: AgentDecision, events: TaskEvent[]): EvaluationResult {
    const criteria = evaluateFinalCriteria(task, events);

    if (!decision.final_answer?.trim()) {
      return {
        pass: false,
        score: 0.1,
        feedback: "Final answer rejected because it is empty.",
        criteria
      };
    }

    if (decision.confidence < task.quality.minFinalConfidence) {
      return {
        pass: false,
        score: 0.25,
        feedback: `Final answer rejected because confidence ${decision.confidence} is below ${task.quality.minFinalConfidence}.`,
        criteria
      };
    }

    const failedRequiredCriteria = criteria.filter((criterion) => criterion.required && !criterion.pass);
    if (failedRequiredCriteria.length > 0) {
      return {
        pass: false,
        score: scoreCriteria(criteria),
        feedback: `Final answer rejected because required evaluation criteria failed: ${failedRequiredCriteria
          .map((criterion) => criterion.id)
          .join(", ")}.`,
        criteria
      };
    }

    return {
      pass: true,
      score: scoreCriteria(criteria),
      feedback: "Final answer accepted by deterministic quality evaluator.",
      criteria
    };
  }
}

function evaluateFinalCriteria(task: TaskInput, events: TaskEvent[]): EvaluationCriterionResult[] {
  return finalCriteria(task).map((criterion) => evaluateCriterion(task, criterion, events));
}

function finalCriteria(task: TaskInput): EvaluationCriterion[] {
  if (task.evaluationCriteria.length > 0) {
    return task.evaluationCriteria;
  }

  const criteria: EvaluationCriterion[] = [];
  if (task.quality.requireEvidenceBeforeFinal) {
    criteria.push({
      id: "tool_evidence",
      kind: "tool_evidence",
      description: "At least one tool result was gathered before completion.",
      required: true
    });
  }
  if (task.quality.requireTestsPassed) {
    criteria.push({
      id: "tests_passed",
      kind: "tests_passed",
      description: "The latest configured test run passed.",
      required: true
    });
  }
  if (task.quality.requireTypecheckPassed) {
    criteria.push({
      id: "typecheck_passed",
      kind: "typecheck_passed",
      description: "The latest configured typecheck run passed.",
      required: true
    });
  }
  return criteria;
}

function evaluateCriterion(
  task: TaskInput,
  criterion: EvaluationCriterion,
  events: TaskEvent[]
): EvaluationCriterionResult {
  switch (criterion.kind) {
    case "tool_evidence": {
      const toolEvents = events.filter((event) => event.type === "tool_result");
      return {
        ...criterion,
        pass: toolEvents.length > 0,
        evidence: toolEvents.map((event) => {
          const payload = event.payload as { result?: { tool?: string } };
          return payload.result?.tool ?? "unknown_tool";
        }),
        feedback:
          toolEvents.length > 0
            ? "Tool evidence was recorded before final completion."
            : "No tool evidence was recorded before final completion."
      };
    }
    case "tests_passed":
      return evaluateToolPassedCriterion(criterion, events, "repo.run_tests", "configured test");
    case "typecheck_passed": {
      if (!task.typecheckCommand) {
        return {
          ...criterion,
          pass: false,
          evidence: [],
          feedback: "Typecheck criterion failed because no typecheck command is configured."
        };
      }
      return evaluateToolPassedCriterion(criterion, events, "repo.run_typecheck", "configured typecheck");
    }
    case "diff_present": {
      const patchEvents = events.filter((event) => {
        if (event.type !== "tool_result") {
          return false;
        }
        const payload = event.payload as { result?: { tool?: string; ok?: boolean; output?: unknown } };
        if (payload.result?.tool === "repo.apply_patch" && payload.result.ok === true) {
          return true;
        }
        if (payload.result?.tool !== "repo.git_diff") {
          return false;
        }
        const output = payload.result.output as { diff?: string } | undefined;
        return Boolean(output?.diff?.trim());
      });
      return {
        ...criterion,
        pass: patchEvents.length > 0,
        evidence: patchEvents.map((event) => {
          const payload = event.payload as { result?: { tool?: string } };
          return payload.result?.tool ?? "unknown_tool";
        }),
        feedback:
          patchEvents.length > 0
            ? "A patch or non-empty git diff was recorded."
            : "No patch or non-empty git diff was recorded."
      };
    }
  }
}

function evaluateToolPassedCriterion(
  criterion: EvaluationCriterion,
  events: TaskEvent[],
  tool: string,
  label: string
): EvaluationCriterionResult {
  const latestOutput = latestToolOutput(events, tool);
  if (!latestOutput) {
    return {
      ...criterion,
      pass: false,
      evidence: [],
      feedback: `No ${label} run was recorded.`
    };
  }

  return {
    ...criterion,
    pass: latestOutput.passed === true,
    evidence: [`${tool}: exitCode=${latestOutput.exitCode ?? "unknown"}`],
    feedback:
      latestOutput.passed === true
        ? `The latest ${label} run passed.`
        : `The latest ${label} run did not pass.`
  };
}

function scoreCriteria(criteria: EvaluationCriterionResult[]): number {
  if (criteria.length === 0) {
    return 1;
  }
  const passed = criteria.filter((criterion) => criterion.pass || !criterion.required).length;
  return passed / criteria.length;
}

function latestToolOutput(events: TaskEvent[], tool: string): { passed?: boolean; exitCode?: number } | undefined {
  return events
    .filter((event) => event.type === "tool_result")
    .map((event) => event.payload as { result?: { tool?: string; output?: unknown } })
    .filter((payload) => payload.result?.tool === tool)
    .at(-1)?.result?.output as { passed?: boolean; exitCode?: number } | undefined;
}
