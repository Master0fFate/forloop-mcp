import { AgentDecisionSchema, type AgentDecision } from "./schemas.js";

export function parseAgentDecision(raw: unknown): { ok: true; decision: AgentDecision } | { ok: false; error: string } {
  let payload: unknown = raw;

  if (typeof raw === "string") {
    try {
      payload = JSON.parse(raw);
    } catch (error) {
      return {
        ok: false,
        error: `Model output was not valid JSON: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  const parsed = AgentDecisionSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((issue) => issue.message).join("; ") };
  }

  return { ok: true, decision: parsed.data };
}
