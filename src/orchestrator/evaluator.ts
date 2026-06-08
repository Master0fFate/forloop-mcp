import type { AgentDecision, EvaluationResult, TaskEvent } from "./schemas.js";

export class DeterministicEvaluator {
  evaluateFinal(decision: AgentDecision, events: TaskEvent[]): EvaluationResult {
    const latestTestOutput = events
      .filter((event) => event.type === "tool_result")
      .map((event) => event.payload as { result?: { tool?: string; output?: unknown } })
      .filter((payload) => payload.result?.tool === "repo.run_tests")
      .at(-1)?.result?.output as { passed?: boolean } | undefined;

    if (latestTestOutput && latestTestOutput.passed !== true) {
      return {
        pass: false,
        score: 0.3,
        feedback: "Final answer rejected because the latest configured test run did not pass."
      };
    }

    if (!decision.final_answer?.trim()) {
      return {
        pass: false,
        score: 0.1,
        feedback: "Final answer rejected because it is empty."
      };
    }

    return {
      pass: true,
      score: 1,
      feedback: "Final answer accepted by deterministic evaluator."
    };
  }
}
