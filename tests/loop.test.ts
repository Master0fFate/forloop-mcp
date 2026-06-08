import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
      expect(result.events.map((event) => event.type)).toContain("quality_eval");
      expect(result.events.map((event) => event.type)).toContain("security_eval");
      expect(result.events.map((event) => event.type)).toContain("governance_decision");
      expect(JSON.stringify(result.events)).toContain('"action":"recover"');
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

  test("abandons after too many empty rounds", async () => {
    const { tempRoot, workspace } = copyFixture();
    const emptyRoundModel: ModelAdapter = {
      provider: "test",
      model: "empty-rounds",
      async generate() {
        return {
          provider: "test",
          model: "empty-rounds",
          raw: {
            status: "final",
            summary: "Keep claiming done without evidence.",
            final_answer: "Done.",
            confidence: 0.9,
            risk: "low",
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
          goal: "Stop empty rounds",
          workspace,
          skill: "repo-debugging",
          model: "mock",
          testCommand: "npm test",
          approvalMode: "auto",
          budget: { maxIterations: 8, maxEmptyRounds: 1 }
        },
        { model: emptyRoundModel }
      );

      expect(result.status).toBe("abandoned");
      expect(result.events.map((event) => event.type)).toContain("empty_round");
      expect(JSON.stringify(result.events)).toContain("empty rounds exceeded");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("abandons when approximate token budget is exhausted", async () => {
    const { tempRoot, workspace } = copyFixture();
    const verboseModel: ModelAdapter = {
      provider: "test",
      model: "verbose",
      async generate() {
        return {
          provider: "test",
          model: "verbose",
          raw: {
            status: "continue",
            summary: "x".repeat(1200),
            next_action: {
              type: "tool_call",
              tool: "repo.run_tests",
              args: { command: "npm test" }
            },
            confidence: 0.8,
            risk: "low",
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
          goal: "Stop when token budget is exhausted",
          workspace,
          skill: "repo-debugging",
          model: "mock",
          testCommand: "npm test",
          approvalMode: "auto",
          budget: { maxIterations: 8, maxApproxTokens: 50 }
        },
        { model: verboseModel }
      );

      expect(result.status).toBe("abandoned");
      expect(result.events.map((event) => event.type)).toContain("budget_eval");
      expect(JSON.stringify(result.events)).toContain("approximate token budget");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("fails missing workspaces without creating them", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "forloop-test-"));
    const workspace = join(tempRoot, "missing-workspace");
    let traceDbPath: string | undefined;

    try {
      const result = await runAgentLoop({
        goal: "Fix a missing project",
        workspace,
        skill: "repo-debugging",
        model: "mock",
        testCommand: "npm test",
        approvalMode: "auto",
        budget: { maxIterations: 8 }
      });
      traceDbPath = result.traceDbPath;

      expect(result.status).toBe("failed");
      expect(existsSync(workspace)).toBe(false);
      expect(JSON.stringify(result.events)).toContain("Workspace does not exist");
    } finally {
      if (traceDbPath) {
        rmSync(traceDbPath, { force: true });
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("records model failures as failed task events", async () => {
    const { tempRoot, workspace } = copyFixture();
    const failingModel: ModelAdapter = {
      provider: "test",
      model: "throws",
      async generate() {
        throw new Error("model edge case");
      },
      supportsTools: () => true,
      supportsJsonMode: () => true
    };

    try {
      const result = await runAgentLoop(
        {
          goal: "Handle model failures",
          workspace,
          skill: "repo-debugging",
          model: "mock",
          testCommand: "npm test",
          approvalMode: "auto",
          budget: { maxIterations: 8 }
        },
        { model: failingModel }
      );

      expect(result.status).toBe("failed");
      expect(result.events.map((event) => event.type)).toContain("model_error");
      expect(JSON.stringify(result.events)).toContain("model edge case");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("quality loop rejects premature finals without evidence", async () => {
    const { tempRoot, workspace } = copyFixture();
    const prematureFinalModel: ModelAdapter = {
      provider: "test",
      model: "premature-final",
      async generate() {
        return {
          provider: "test",
          model: "premature-final",
          raw: {
            status: "final",
            summary: "Claim done without inspecting or testing anything.",
            final_answer: "Done.",
            confidence: 0.9,
            risk: "low",
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
          goal: "Do not accept unsupported completion claims",
          workspace,
          skill: "repo-debugging",
          model: "mock",
          testCommand: "npm test",
          approvalMode: "auto",
          budget: { maxIterations: 2 }
        },
        { model: prematureFinalModel }
      );

      expect(result.status).toBe("abandoned");
      expect(result.events.map((event) => event.type)).toContain("quality_eval");
      expect(result.events.map((event) => event.type)).toContain("final_rejected");
      expect(result.events.map((event) => event.type)).toContain("governance_decision");
      expect(JSON.stringify(result.events)).toContain("No tool evidence");
      expect(JSON.stringify(result.events)).toContain("Mission abandoned");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("quality loop rejects low-confidence finals", async () => {
    const { tempRoot, workspace } = copyFixture();
    const lowConfidenceModel: ModelAdapter = {
      provider: "test",
      model: "low-confidence-final",
      async generate(request) {
        const hasRunTests = request.events.some((event) => {
          const payload = event.payload as { result?: { tool?: string } };
          return event.type === "tool_result" && payload.result?.tool === "repo.run_tests";
        });

        if (!hasRunTests) {
          return {
            provider: "test",
            model: "low-confidence-final",
            raw: {
              status: "continue",
              summary: "Gather test evidence first.",
              next_action: {
                type: "tool_call",
                tool: "repo.run_tests",
                args: { command: request.task.testCommand }
              },
              confidence: 0.8,
              risk: "low",
              requires_human_approval: false
            }
          };
        }

        return {
          provider: "test",
          model: "low-confidence-final",
          raw: {
            status: "final",
            summary: "Weakly claim done.",
            final_answer: "Probably done.",
            confidence: 0.1,
            risk: "low",
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
          goal: "Reject low-confidence completions",
          workspace,
          skill: "repo-debugging",
          model: "mock",
          testCommand: "npm test",
          approvalMode: "auto",
          quality: { minFinalConfidence: 0.6 },
          budget: { maxIterations: 3 }
        },
        { model: lowConfidenceModel }
      );

      expect(result.status).toBe("abandoned");
      expect(result.events.map((event) => event.type)).toContain("final_rejected");
      expect(JSON.stringify(result.events)).toContain("confidence 0.1 is below 0.6");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("quality loop can require an independent typecheck verifier", async () => {
    const { tempRoot, workspace } = copyFixture();
    try {
      const result = await runAgentLoop({
        goal: "Fix failing password validation tests",
        workspace,
        skill: "repo-debugging",
        model: "mock",
        testCommand: "npm test",
        typecheckCommand: "npm test",
        approvalMode: "auto",
        quality: { requireTypecheckPassed: true },
        budget: { maxIterations: 10 }
      });

      expect(result.status).toBe("completed");
      expect(JSON.stringify(result.events)).toContain("repo.run_typecheck");
      expect(JSON.stringify(result.events)).toContain("configured_typecheck");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("quality loop rejects finals when required typecheck evidence is missing", async () => {
    const { tempRoot, workspace } = copyFixture();
    const finalAfterTestsModel: ModelAdapter = {
      provider: "test",
      model: "skips-typecheck",
      async generate(request) {
        const hasRunTests = request.events.some((event) => {
          const payload = event.payload as { result?: { tool?: string } };
          return event.type === "tool_result" && payload.result?.tool === "repo.run_tests";
        });

        if (!hasRunTests) {
          return {
            provider: "test",
            model: "skips-typecheck",
            raw: {
              status: "continue",
              summary: "Gather test evidence first.",
              next_action: {
                type: "tool_call",
                tool: "repo.run_tests",
                args: { command: request.task.testCommand }
              },
              confidence: 0.8,
              risk: "low",
              requires_human_approval: false
            }
          };
        }

        return {
          provider: "test",
          model: "skips-typecheck",
          raw: {
            status: "final",
            summary: "Try to skip the configured typecheck verifier.",
            final_answer: "Done.",
            confidence: 0.9,
            risk: "low",
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
          goal: "Require typecheck verifier",
          workspace,
          skill: "repo-debugging",
          model: "mock",
          testCommand: "node -e \"process.exit(0)\"",
          typecheckCommand: "node -e \"process.exit(0)\"",
          approvalMode: "auto",
          quality: { requireTypecheckPassed: true },
          budget: { maxIterations: 3 }
        },
        { model: finalAfterTestsModel }
      );

      expect(result.status).toBe("abandoned");
      expect(result.events.map((event) => event.type)).toContain("final_rejected");
      expect(JSON.stringify(result.events)).toContain("typecheck_passed");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("custom evaluation criteria reject finals without required evidence", async () => {
    const { tempRoot, workspace } = copyFixture();
    const finalAfterTestsModel: ModelAdapter = {
      provider: "test",
      model: "criteria-final",
      async generate(request) {
        const hasRunTests = request.events.some((event) => {
          const payload = event.payload as { result?: { tool?: string } };
          return event.type === "tool_result" && payload.result?.tool === "repo.run_tests";
        });

        if (!hasRunTests) {
          return {
            provider: "test",
            model: "criteria-final",
            raw: {
              status: "continue",
              summary: "Gather test evidence first.",
              next_action: {
                type: "tool_call",
                tool: "repo.run_tests",
                args: { command: request.task.testCommand }
              },
              confidence: 0.8,
              risk: "low",
              requires_human_approval: false
            }
          };
        }

        return {
          provider: "test",
          model: "criteria-final",
          raw: {
            status: "final",
            summary: "Try to finalize without change evidence.",
            final_answer: "Done.",
            confidence: 0.9,
            risk: "low",
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
          goal: "Require explicit change evidence",
          workspace,
          skill: "repo-debugging",
          model: "mock",
          testCommand: "node -e \"process.exit(0)\"",
          approvalMode: "auto",
          evaluationCriteria: [
            {
              id: "tests_passed",
              kind: "tests_passed",
              description: "The latest configured test run passed.",
              required: true
            },
            {
              id: "diff_present",
              kind: "diff_present",
              description: "A patch or diff was recorded before final completion.",
              required: true
            }
          ],
          budget: { maxIterations: 3 }
        },
        { model: finalAfterTestsModel }
      );

      expect(result.status).toBe("abandoned");
      expect(result.events.map((event) => event.type)).toContain("final_rejected");
      expect(JSON.stringify(result.events)).toContain("diff_present");
      expect(JSON.stringify(result.events)).toContain("No patch or non-empty git diff was recorded");
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
      expect(result.events.map((event) => event.type)).toContain("security_eval");
      expect(JSON.stringify(loopEval?.payload)).toContain('"gate":"stop"');
      expect(JSON.stringify(loopEval?.payload)).toContain("Only the configured test command is allowed");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("security gate denies tools outside the sanctioned set before execution", async () => {
    const { tempRoot, workspace } = copyFixture();
    const unsanctionedToolModel: ModelAdapter = {
      provider: "test",
      model: "unsanctioned-tool",
      async generate() {
        return {
          provider: "test",
          model: "unsanctioned-tool",
          raw: {
            status: "continue",
            summary: "Try an unsanctioned discovery action.",
            next_action: {
              type: "tool_call",
              tool: "repo.read_file",
              args: { path: "src/validatePassword.js" }
            },
            confidence: 0.8,
            risk: "low",
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
          goal: "Deny unsanctioned tools",
          workspace,
          skill: "repo-debugging",
          model: "mock",
          testCommand: "npm test",
          approvalMode: "auto",
          security: { allowedTools: ["repo.run_tests"] },
          budget: { maxIterations: 3 }
        },
        { model: unsanctionedToolModel }
      );

      expect(result.status).toBe("failed");
      expect(result.events.map((event) => event.type)).toContain("security_eval");
      expect(result.events.map((event) => event.type)).toContain("tool_denied");
      expect(result.events.map((event) => event.type)).not.toContain("tool_call");
      expect(JSON.stringify(result.events)).toContain("Denied unsanctioned tool: repo.read_file");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("governance escalates high-risk actions before execution", async () => {
    const { tempRoot, workspace } = copyFixture();
    const highRiskModel: ModelAdapter = {
      provider: "test",
      model: "high-risk",
      async generate(request) {
        return {
          provider: "test",
          model: "high-risk",
          raw: {
            status: "continue",
            summary: "Run a high-risk verifier action.",
            next_action: {
              type: "tool_call",
              tool: "repo.run_tests",
              args: { command: request.task.testCommand }
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
          goal: "Escalate high-risk decisions",
          workspace,
          skill: "repo-debugging",
          model: "mock",
          testCommand: "npm test",
          approvalMode: "deny",
          budget: { maxIterations: 3 }
        },
        { model: highRiskModel }
      );

      expect(result.status).toBe("stopped_by_human");
      expect(result.events.map((event) => event.type)).toContain("governance_decision");
      expect(JSON.stringify(result.events)).toContain('"action":"escalate"');
      expect(result.events.map((event) => event.type)).toContain("approval_requested");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
