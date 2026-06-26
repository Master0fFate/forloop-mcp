import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { resolveSessionIdentity } from "../src/orchestrator/session.js";
import { SessionMemoryStore, memoryDbPathForSession } from "../src/memory/store.js";

describe("session memory store", () => {
  test("keeps long-term memories isolated by session storage name", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "forloop-memory-test-"));
    const firstSession = resolveSessionIdentity("thread-alpha", "stable-a");
    const secondSession = resolveSessionIdentity("thread-beta", "stable-b");

    const first = await SessionMemoryStore.open({ workspace, session: firstSession });
    const second = await SessionMemoryStore.open({ workspace, session: secondSession });

    try {
      const alphaRecord = first.remember({
        content: "Alpha session learned the HUD issue belongs to another thread.",
        tags: ["session", "hud"],
        source: "test"
      });
      second.remember({
        content: "Beta session is focused on provider configuration.",
        tags: ["provider"],
        source: "test"
      });

      expect(alphaRecord.sessionStorageName).toBe(firstSession.storageName);
      expect(memoryDbPathForSession(workspace, firstSession)).not.toBe(
        memoryDbPathForSession(workspace, secondSession)
      );
      expect(first.search({ query: "HUD" }).records).toHaveLength(1);
      expect(second.search({ query: "HUD" }).records).toHaveLength(0);
      expect(second.list({ limit: 10 }).records.map((record) => record.content)).not.toContain(
        alphaRecord.content
      );
    } finally {
      first.close();
      second.close();
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
