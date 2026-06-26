import type { ModelRequest } from "../models/base.js";

export function sampleModelRequest(workspace: string): ModelRequest {
  return {
    task: {
      goal: "Validate provider configuration",
      workspace,
      skill: "repo-debugging",
      model: "mock",
      testCommand: "npm test",
      approvalMode: "auto",
      quality: {
        minStepScore: 0.2,
        minFinalConfidence: 0,
        requireEvidenceBeforeFinal: false,
        requireTestsPassed: false,
        requireTypecheckPassed: false
      },
      governance: {
        escalateHighRisk: true,
        recoverOnFailedStep: true,
        maxRecoveryAttempts: 3,
        maxFinalRejections: 2,
        maxConsecutiveFailedSteps: 3
      },
      security: { allowedTools: [], requireApprovalForMutations: true },
      evaluationCriteria: [],
      budget: { maxIterations: 1, maxInvalidDecisions: 2, maxRepeatedActions: 3, maxEmptyRounds: 2 }
    },
    skill: { name: "repo-debugging", path: "web", content: "Provider validation request." },
    tools: [],
    events: [],
    stateSummary: "No state yet."
  };
}
