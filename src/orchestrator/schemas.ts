import { z } from "zod";

export const BudgetConfigSchema = z.object({
  maxIterations: z.coerce.number().int().positive().default(8),
  maxInvalidDecisions: z.coerce.number().int().nonnegative().default(2),
  maxRepeatedActions: z.coerce.number().int().positive().default(3)
}).default({
  maxIterations: 8,
  maxInvalidDecisions: 2,
  maxRepeatedActions: 3
});

export type BudgetConfig = z.infer<typeof BudgetConfigSchema>;

export const QualityConfigSchema = z.object({
  minStepScore: z.coerce.number().min(0).max(1).default(0.2),
  minFinalConfidence: z.coerce.number().min(0).max(1).default(0.6),
  requireEvidenceBeforeFinal: z.boolean().default(true),
  requireTestsPassed: z.boolean().default(true)
}).default({
  minStepScore: 0.2,
  minFinalConfidence: 0.6,
  requireEvidenceBeforeFinal: true,
  requireTestsPassed: true
});

export type QualityConfig = z.infer<typeof QualityConfigSchema>;

export const ApprovalModeSchema = z.enum(["manual", "auto", "deny"]);

export const TaskInputSchema = z.object({
  goal: z.string().min(1),
  workspace: z.string().min(1),
  skill: z.string().min(1).default("repo-debugging"),
  model: z.enum(["mock", "openai"]).default("mock"),
  testCommand: z.string().min(1).default("npm test"),
  approvalMode: ApprovalModeSchema.default("manual"),
  traceDbPath: z.string().optional(),
  quality: QualityConfigSchema,
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
  feedback: z.string()
});

export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;

export const StepEvaluationResultSchema = EvaluationResultSchema.extend({
  gate: z.enum(["continue", "stop"])
});

export type StepEvaluationResult = z.infer<typeof StepEvaluationResultSchema>;

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
  status: z.enum(["completed", "failed", "budget_exceeded", "stopped_by_human"]),
  finalAnswer: z.string().optional(),
  events: z.array(TaskEventSchema),
  traceDbPath: z.string()
});

export type TaskResult = z.infer<typeof TaskResultSchema>;
