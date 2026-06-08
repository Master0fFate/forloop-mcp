import type {
  AgentDecision,
  EvaluationResult,
  GovernanceDecisionResult,
  StepEvaluationResult,
  TaskEvent,
  TaskInput,
  ToolResult
} from "./schemas.js";

export class DeterministicGovernance {
  assessDecision(task: TaskInput, decision: AgentDecision, events: TaskEvent[]): GovernanceDecisionResult {
    if (decision.status === "needs_human") {
      return {
        action: "escalate",
        reason: "Model requested human input.",
        metrics: baseMetrics(events)
      };
    }

    if (task.governance.escalateHighRisk && decision.risk === "high") {
      return {
        action: "escalate",
        reason: "High-risk model decision requires escalation before execution.",
        metrics: baseMetrics(events)
      };
    }

    return {
      action: "continue",
      reason: "Governance found no pre-action stop or escalation condition.",
      metrics: baseMetrics(events)
    };
  }

  assessStep(
    task: TaskInput,
    result: ToolResult,
    evaluation: StepEvaluationResult,
    events: TaskEvent[]
  ): GovernanceDecisionResult {
    const metrics = {
      ...baseMetrics(events),
      consecutiveFailedSteps: countConsecutiveFailedStepEvals(events),
      recoveryAttempts: countGovernanceActions(events, "recover")
    };

    if (evaluation.gate === "stop") {
      return {
        action: "stop",
        reason: evaluation.feedback,
        metrics
      };
    }

    if (evaluation.pass) {
      return {
        action: "continue",
        reason: "Step cleared governance checks.",
        metrics
      };
    }

    if (metrics.consecutiveFailedSteps >= task.governance.maxConsecutiveFailedSteps) {
      return {
        action: "abandon",
        reason: "Mission abandoned because consecutive failed steps exceeded governance limits.",
        metrics
      };
    }

    if (!task.governance.recoverOnFailedStep) {
      return {
        action: "stop",
        reason: "Step failed and recovery is disabled by governance policy.",
        metrics
      };
    }

    if (metrics.recoveryAttempts >= task.governance.maxRecoveryAttempts) {
      return {
        action: "abandon",
        reason: "Mission abandoned because recovery attempts exceeded governance limits.",
        metrics
      };
    }

    return {
      action: "recover",
      reason: result.ok
        ? "Step did not meet quality criteria; recover with the evaluator feedback."
        : "Tool failed; recover with the tool error and evaluator feedback.",
      metrics
    };
  }

  assessFinalRejection(
    task: TaskInput,
    evaluation: EvaluationResult,
    events: TaskEvent[]
  ): GovernanceDecisionResult {
    const metrics = {
      ...baseMetrics(events),
      finalRejections: countEvents(events, "final_rejected"),
      recoveryAttempts: countGovernanceActions(events, "recover")
    };

    if (evaluation.pass) {
      return {
        action: "stop",
        reason: "Final answer passed quality gates.",
        metrics
      };
    }

    if (metrics.finalRejections >= task.governance.maxFinalRejections) {
      return {
        action: "abandon",
        reason: "Mission abandoned because final answers repeatedly failed quality gates.",
        metrics
      };
    }

    if (metrics.recoveryAttempts >= task.governance.maxRecoveryAttempts) {
      return {
        action: "abandon",
        reason: "Mission abandoned because recovery attempts exceeded governance limits.",
        metrics
      };
    }

    return {
      action: "recover",
      reason: "Final answer failed quality gates; recover with quality feedback.",
      metrics
    };
  }

  assessBudgetExceeded(task: TaskInput, events: TaskEvent[]): GovernanceDecisionResult {
    return {
      action: "abandon",
      reason: "Mission abandoned because the iteration budget was exhausted.",
      metrics: {
        ...baseMetrics(events),
        maxIterations: task.budget.maxIterations
      }
    };
  }

  assessEmptyRounds(task: TaskInput, events: TaskEvent[]): GovernanceDecisionResult {
    return {
      action: "abandon",
      reason: "Mission abandoned because empty rounds exceeded governance limits.",
      metrics: {
        ...baseMetrics(events),
        emptyRounds: countEvents(events, "empty_round"),
        maxEmptyRounds: task.budget.maxEmptyRounds
      }
    };
  }

  assessTokenBudget(task: TaskInput, events: TaskEvent[], approxTokens: number): GovernanceDecisionResult {
    return {
      action: "abandon",
      reason: "Mission abandoned because the approximate token budget was exhausted.",
      metrics: {
        ...baseMetrics(events),
        approxTokens,
        maxApproxTokens: task.budget.maxApproxTokens
      }
    };
  }
}

function baseMetrics(events: TaskEvent[]): Record<string, unknown> {
  return {
    iterations: countEvents(events, "iteration_started"),
    finalRejections: countEvents(events, "final_rejected"),
    recoveryAttempts: countGovernanceActions(events, "recover")
  };
}

function countEvents(events: TaskEvent[], type: string): number {
  return events.filter((event) => event.type === type).length;
}

function countGovernanceActions(events: TaskEvent[], action: GovernanceDecisionResult["action"]): number {
  return events.filter((event) => {
    if (event.type !== "governance_decision") {
      return false;
    }
    const payload = event.payload as { decision?: { action?: string } };
    return payload.decision?.action === action;
  }).length;
}

function countConsecutiveFailedStepEvals(events: TaskEvent[]): number {
  let count = 0;
  for (const event of [...events].reverse()) {
    if (event.type !== "quality_eval") {
      continue;
    }
    const payload = event.payload as { phase?: string; evaluation?: { pass?: boolean } };
    if (payload.phase !== "step") {
      continue;
    }
    if (payload.evaluation?.pass === false) {
      count += 1;
      continue;
    }
    return count;
  }
  return count;
}
