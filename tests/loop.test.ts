import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { runAgentLoop } from "../src/orchestrator/loop.js";

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
});
