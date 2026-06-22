import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import type { ModelAdapter } from "../src/models/base.js";
import { runAgentLoop } from "../src/orchestrator/loop.js";

const projectRoot = resolve(import.meta.dirname, "..");

function copyFixture(): { readonly tempRoot: string; readonly workspace: string } {
  const tempRoot = mkdtempSync(join(tmpdir(), "forloop-session-test-"));
  const workspace = join(tempRoot, "buggy-auth-service");
  cpSync(join(projectRoot, "examples", "buggy-auth-service"), workspace, { recursive: true });
  return { tempRoot, workspace };
}

const fastFinalModel: ModelAdapter = {
  provider: "test",
  model: "fast-final",
  async generate() {
    return {
      provider: "test",
      model: "fast-final",
      raw: {
        status: "final",
        summary: "Done with enough confidence for this isolation test.",
        final_answer: "Done.",
        confidence: 1,
        risk: "low",
        requires_human_approval: false
      }
    };
  },
  supportsTools: () => true,
  supportsJsonMode: () => true
};

describe("session isolation", () => {
  test("uses separate default trace databases for separate sessions", async () => {
    const { tempRoot, workspace } = copyFixture();

    try {
      const first = await runAgentLoop(
        {
          goal: "Session A",
          workspace,
          skill: "repo-debugging",
          model: "mock",
          testCommand: "npm test",
          approvalMode: "auto",
          quality: { requireEvidenceBeforeFinal: false, requireTestsPassed: false },
          sessionId: "codex-thread-a",
          budget: { maxIterations: 1 }
        },
        { model: fastFinalModel }
      );
      const second = await runAgentLoop(
        {
          goal: "Session B",
          workspace,
          skill: "repo-debugging",
          model: "mock",
          testCommand: "npm test",
          approvalMode: "auto",
          quality: { requireEvidenceBeforeFinal: false, requireTestsPassed: false },
          sessionId: "codex-thread-b",
          budget: { maxIterations: 1 }
        },
        { model: fastFinalModel }
      );

      expect(first.traceDbPath).not.toBe(second.traceDbPath);
      expect(first.traceDbPath).toContain(join(".forloop", "sessions"));
      expect(second.traceDbPath).toContain(join(".forloop", "sessions"));
      expect(existsSync(first.traceDbPath)).toBe(true);
      expect(existsSync(second.traceDbPath)).toBe(true);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("keeps explicit trace database paths session-scoped", async () => {
    const { tempRoot, workspace } = copyFixture();
    const requestedTraceDbPath = join(tempRoot, "trace.sqlite");

    try {
      const first = await runAgentLoop(
        {
          goal: "Explicit trace A",
          workspace,
          skill: "repo-debugging",
          model: "mock",
          testCommand: "npm test",
          approvalMode: "auto",
          quality: { requireEvidenceBeforeFinal: false, requireTestsPassed: false },
          sessionId: "codex-thread-a",
          traceDbPath: requestedTraceDbPath,
          budget: { maxIterations: 1 }
        },
        { model: fastFinalModel }
      );
      const second = await runAgentLoop(
        {
          goal: "Explicit trace B",
          workspace,
          skill: "repo-debugging",
          model: "mock",
          testCommand: "npm test",
          approvalMode: "auto",
          quality: { requireEvidenceBeforeFinal: false, requireTestsPassed: false },
          sessionId: "codex-thread-b",
          traceDbPath: requestedTraceDbPath,
          budget: { maxIterations: 1 }
        },
        { model: fastFinalModel }
      );

      expect(first.traceDbPath).not.toBe(second.traceDbPath);
      expect(first.traceDbPath).toContain(join("sessions", first.sessionStorageName));
      expect(second.traceDbPath).toContain(join("sessions", second.sessionStorageName));
      expect(first.traceDbPath.endsWith("trace.sqlite")).toBe(true);
      expect(second.traceDbPath.endsWith("trace.sqlite")).toBe(true);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
