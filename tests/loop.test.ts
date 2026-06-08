import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { runAgentLoop } from "../src/orchestrator/loop.js";
import type { ModelAdapter } from "../src/models/base.js";

const projectRoot = resolve(import.meta.dirname, "..");

function copyFixture(): { tempRoot: string; workspace: string } {
  const tempRoot = mkdtempSync(join(tmpdir(), "forloop-test-"));
  const workspace = join(tempRoot, "buggy-auth-service");
  cpSync(join(projectRoot, "examples", "buggy-auth-service"), workspace, { recursive: true });
  return { tempRoot, workspace };
}

describe("agent loop", () => {
  test("fixes the demo repo with the mock model", async () => {
    const { tempRoot, workspace } = copyFixture();
    try {
      const result = await runAgentLoop({
        goal: "Fix failing password validation tests",
        workspace,
        skill: "repo-debugging",
        model: "mock",
        testCommand: "npm test",
        approvalMode: "auto",
        budget: { maxIterations: 8 }
      });

      expect(result.status).toBe("completed");
      expect(result.events.map((event) => event.type)).toContain("approval_requested");
      expect(result.events.map((event) => event.type)).toContain("loop_eval");
      expect(readFileSync(join(workspace, "src", "validatePassword.js"), "utf8")).toContain(
        "password.trim().length > 0"
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("stops when approval is denied", async () => {
    const { tempRoot, workspace } = copyFixture();
    try {
      const result = await runAgentLoop({
        goal: "Fix failing password validation tests",
        workspace,
        skill: "repo-debugging",
        model: "mock",
        testCommand: "npm test",
        approvalMode: "deny",
        budget: { maxIterations: 8 }
      });

      expect(result.status).toBe("stopped_by_human");
      expect(readFileSync(join(workspace, "src", "validatePassword.js"), "utf8")).toContain(
        "password !== undefined"
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("reports budget exhaustion", async () => {
    const { tempRoot, workspace } = copyFixture();
    try {
      const result = await runAgentLoop({
        goal: "Fix failing password validation tests",
        workspace,
        skill: "repo-debugging",
        model: "mock",
        testCommand: "npm test",
        approvalMode: "auto",
        budget: { maxIterations: 1 }
      });

      expect(result.status).toBe("budget_exceeded");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("stops policy-breaking actions at the loop eval gate", async () => {
    const { tempRoot, workspace } = copyFixture();
    const unsafeModel: ModelAdapter = {
      provider: "test",
      model: "unsafe-command",
      async generate() {
        return {
          provider: "test",
          model: "unsafe-command",
          raw: {
            status: "continue",
            summary: "Try to run an unconfigured command.",
            next_action: {
              type: "tool_call",
              tool: "repo.run_tests",
              args: { command: "npm run arbitrary" }
            },
            confidence: 0.8,
            risk: "high",
            requires_human_approval: false
          }
        };
      },
      supportsTools: () => true,
      supportsJsonMode: () => true
    };

    try {
      const result = await runAgentLoop(
        {
          goal: "Break out of the configured test command",
          workspace,
          skill: "repo-debugging",
          model: "mock",
          testCommand: "npm test",
          approvalMode: "auto",
          budget: { maxIterations: 8 }
        },
        { model: unsafeModel }
      );

      const loopEval = result.events.find((event) => event.type === "loop_eval");
      expect(result.status).toBe("failed");
      expect(JSON.stringify(loopEval?.payload)).toContain('"gate":"stop"');
      expect(JSON.stringify(loopEval?.payload)).toContain("Only the configured test command is allowed");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
