import type { AgentDecision, EvaluationResult, StepEvaluationResult, TaskEvent, TaskInput, ToolResult } from "./schemas.js";

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
      if (error.includes("Path escapes workspace") || error.includes("Only the configured test command is allowed")) {
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
    const latestTestOutput = latestToolOutput(events, "repo.run_tests");
    const latestTypecheckOutput = latestToolOutput(events, "repo.run_typecheck");

    if (!decision.final_answer?.trim()) {
      return {
        pass: false,
        score: 0.1,
        feedback: "Final answer rejected because it is empty."
      };
    }

    if (decision.confidence < task.quality.minFinalConfidence) {
      return {
        pass: false,
        score: 0.25,
        feedback: `Final answer rejected because confidence ${decision.confidence} is below ${task.quality.minFinalConfidence}.`
      };
    }

    if (task.quality.requireEvidenceBeforeFinal) {
      const hasToolEvidence = events.some((event) => event.type === "tool_result");
      if (!hasToolEvidence) {
        return {
          pass: false,
          score: 0.2,
          feedback: "Final answer rejected because no tool evidence was gathered before completion."
        };
      }
    }

    if (task.quality.requireTestsPassed) {
      if (!latestTestOutput) {
        return {
          pass: false,
          score: 0.2,
          feedback: "Final answer rejected because no configured test run was recorded."
        };
      }

      if (latestTestOutput.passed !== true) {
        return {
          pass: false,
          score: 0.3,
          feedback: "Final answer rejected because the latest configured test run did not pass."
        };
      }
    }

    if (task.quality.requireTypecheckPassed) {
      if (!task.typecheckCommand) {
        return {
          pass: false,
          score: 0.2,
          feedback: "Final answer rejected because typecheck verification is required but no typecheck command is configured."
        };
      }

      if (!latestTypecheckOutput) {
        return {
          pass: false,
          score: 0.2,
          feedback: "Final answer rejected because no configured typecheck run was recorded."
        };
      }

      if (latestTypecheckOutput.passed !== true) {
        return {
          pass: false,
          score: 0.3,
          feedback: "Final answer rejected because the latest configured typecheck run did not pass."
        };
      }
    }

    return {
      pass: true,
      score: 1,
      feedback: "Final answer accepted by deterministic quality evaluator."
    };
  }
}

function latestToolOutput(events: TaskEvent[], tool: string): { passed?: boolean } | undefined {
  return events
    .filter((event) => event.type === "tool_result")
    .map((event) => event.payload as { result?: { tool?: string; output?: unknown } })
    .filter((payload) => payload.result?.tool === tool)
    .at(-1)?.result?.output as { passed?: boolean } | undefined;
}
