import { describe, expect, test } from "vitest";
import { parseAgentDecision } from "../src/orchestrator/decision.js";

describe("decision parsing", () => {
  test("rejects invalid JSON", () => {
    const parsed = parseAgentDecision("{not json");
    expect(parsed.ok).toBe(false);
  });

  test("requires a next action for continue decisions", () => {
    const parsed = parseAgentDecision({ status: "continue", summary: "No action yet" });
    expect(parsed.ok).toBe(false);
  });

  test("accepts a valid tool decision", () => {
    const parsed = parseAgentDecision({
      status: "continue",
      summary: "Read a file",
      next_action: { type: "tool_call", tool: "repo.read_file", args: { path: "x.js" } }
    });
    expect(parsed.ok).toBe(true);
  });
});
