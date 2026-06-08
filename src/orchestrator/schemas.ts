import { z } from "zod";

export const BudgetConfigSchema = z.object({
  maxIterations: z.coerce.number().int().positive().default(8),
  maxInvalidDecisions: z.coerce.number().int().nonnegative().default(2),
  maxRepeatedActions: z.coerce.number().int().positive().default(3),
  maxEmptyRounds: z.coerce.number().int().nonnegative().default(2),
  maxApproxTokens: z.coerce.number().int().positive().optional()
}).default({
  maxIterations: 8,
  maxInvalidDecisions: 2,
  maxRepeatedActions: 3,
  maxEmptyRounds: 2
});

export type BudgetConfig = z.infer<typeof BudgetConfigSchema>;

export const QualityConfigSchema = z.object({
  minStepScore: z.coerce.number().min(0).max(1).default(0.2),
  minFinalConfidence: z.coerce.number().min(0).max(1).default(0),
  requireEvidenceBeforeFinal: z.boolean().default(true),
  requireTestsPassed: z.boolean().default(true),
  requireTypecheckPassed: z.boolean().default(false)
}).default({
  minStepScore: 0.2,
  minFinalConfidence: 0,
  requireEvidenceBeforeFinal: true,
  requireTestsPassed: true,
  requireTypecheckPassed: false
});

export type QualityConfig = z.infer<typeof QualityConfigSchema>;

export const GovernanceConfigSchema = z.object({
  escalateHighRisk: z.boolean().default(true),
  recoverOnFailedStep: z.boolean().default(true),
  maxRecoveryAttempts: z.coerce.number().int().nonnegative().default(3),
  maxFinalRejections: z.coerce.number().int().positive().default(2),
  maxConsecutiveFailedSteps: z.coerce.number().int().positive().default(3)
}).default({
  escalateHighRisk: true,
  recoverOnFailedStep: true,
  maxRecoveryAttempts: 3,
  maxFinalRejections: 2,
  maxConsecutiveFailedSteps: 3
});

export type GovernanceConfig = z.infer<typeof GovernanceConfigSchema>;

const defaultAllowedTools = [
  "repo.list_files",
  "repo.search_code",
  "repo.read_file",
  "repo.apply_patch",
  "repo.run_tests",
  "repo.run_typecheck",
  "repo.git_diff"
];

export const SecurityConfigSchema = z.object({
  allowedTools: z.array(z.string().min(1)).default(defaultAllowedTools),
  requireApprovalForMutations: z.boolean().default(true)
}).default({
  allowedTools: defaultAllowedTools,
  requireApprovalForMutations: true
});

export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;

export const EvaluationCriterionKindSchema = z.enum([
  "tool_evidence",
  "tests_passed",
  "typecheck_passed",
  "diff_present"
]);

export const EvaluationCriterionSchema = z.object({
  id: z.string().min(1),
  kind: EvaluationCriterionKindSchema,
  description: z.string().min(1),
  required: z.boolean().default(true)
});

export type EvaluationCriterion = z.infer<typeof EvaluationCriterionSchema>;

export const EvaluationCriterionResultSchema = EvaluationCriterionSchema.extend({
  pass: z.boolean(),
  evidence: z.array(z.string()).default([]),
  feedback: z.string()
});

export type EvaluationCriterionResult = z.infer<typeof EvaluationCriterionResultSchema>;

export const ApprovalModeSchema = z.enum(["manual", "auto", "deny"]);

export const TaskInputSchema = z.object({
  goal: z.string().min(1),
  workspace: z.string().min(1),
  skill: z.string().min(1).default("repo-debugging"),
  model: z.enum(["mock", "openai"]).default("mock"),
  testCommand: z.string().min(1).default("npm test"),
  typecheckCommand: z.string().min(1).optional(),
  approvalMode: ApprovalModeSchema.default("manual"),
  traceDbPath: z.string().optional(),
  quality: QualityConfigSchema,
  governance: GovernanceConfigSchema,
  security: SecurityConfigSchema,
  evaluationCriteria: z.array(EvaluationCriterionSchema).default([]),
  budget: BudgetConfigSchema
});

export type TaskInput = z.infer<typeof TaskInputSchema>;

export const ToolCallActionSchema = z.object({
  type: z.literal("tool_call"),
  tool: z.string().min(1),
  args: z.record(z.string(), z.unknown()).default({})
});

export type ToolCallAction = z.infer<typeof ToolCallActionSchema>;

export const AgentDecisionSchema = z
  .object({
    status: z.enum(["continue", "final", "failed", "needs_human"]),
    summary: z.string().min(1),
    next_action: ToolCallActionSchema.optional(),
    final_answer: z.string().optional(),
    confidence: z.number().min(0).max(1).default(0.5),
    risk: z.enum(["low", "medium", "high"]).default("low"),
    requires_human_approval: z.boolean().default(false)
  })
  .superRefine((decision, ctx) => {
    if (decision.status === "continue" && !decision.next_action) {
      ctx.addIssue({
        code: "custom",
        path: ["next_action"],
        message: "continue decisions must include next_action"
      });
    }

    if (decision.status === "final" && !decision.final_answer) {
      ctx.addIssue({
        code: "custom",
        path: ["final_answer"],
        message: "final decisions must include final_answer"
      });
    }
  });

export type AgentDecision = z.infer<typeof AgentDecisionSchema>;

export const ToolResultSchema = z.object({
  tool: z.string(),
  ok: z.boolean(),
  output: z.unknown().optional(),
  error: z.string().optional()
});

export type ToolResult = z.infer<typeof ToolResultSchema>;

export const ApprovalResultSchema = z.object({
  approved: z.boolean(),
  mode: ApprovalModeSchema,
  reason: z.string().optional()
});

export type ApprovalResult = z.infer<typeof ApprovalResultSchema>;

export const EvaluationResultSchema = z.object({
  pass: z.boolean(),
  score: z.number().min(0).max(1),
  feedback: z.string(),
  criteria: z.array(EvaluationCriterionResultSchema).optional()
});

export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;

export const StepEvaluationResultSchema = EvaluationResultSchema.extend({
  gate: z.enum(["continue", "stop"])
});

export type StepEvaluationResult = z.infer<typeof StepEvaluationResultSchema>;

export const GovernanceActionSchema = z.enum(["continue", "recover", "escalate", "stop", "abandon"]);

export const GovernanceDecisionResultSchema = z.object({
  action: GovernanceActionSchema,
  reason: z.string(),
  metrics: z.record(z.string(), z.unknown()).default({})
});

export type GovernanceDecisionResult = z.infer<typeof GovernanceDecisionResultSchema>;

export const SecurityActionSchema = z.enum(["allow", "escalate", "deny"]);

export const SecurityDecisionResultSchema = z.object({
  action: SecurityActionSchema,
  reason: z.string(),
  boundary: z.enum(["tool", "mutation", "command", "workspace", "policy"]),
  metrics: z.record(z.string(), z.unknown()).default({})
});

export type SecurityDecisionResult = z.infer<typeof SecurityDecisionResultSchema>;

export const TaskEventSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  timestamp: z.string(),
  type: z.string(),
  payload: z.unknown()
});

export type TaskEvent = z.infer<typeof TaskEventSchema>;

export const TaskResultSchema = z.object({
  taskId: z.string(),
  status: z.enum(["completed", "failed", "budget_exceeded", "stopped_by_human", "abandoned"]),
  finalAnswer: z.string().optional(),
  events: z.array(TaskEventSchema),
  traceDbPath: z.string()
});

export type TaskResult = z.infer<typeof TaskResultSchema>;
