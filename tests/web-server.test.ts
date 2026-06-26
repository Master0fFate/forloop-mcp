import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createForLoopWebServer, type ForLoopWebServer } from "../src/web/server.js";

const servers: ForLoopWebServer[] = [];

afterEach(async () => {
  await Promise.all(servers.map((server) => server.close()));
  servers.length = 0;
});

describe("web server", () => {
  test("serves status, memory, provider validation, and default shell policy APIs", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "forloop-web-test-"));
    const web = await createForLoopWebServer({
      workspace,
      host: "127.0.0.1",
      port: 0,
      sessionId: "web-session"
    });
    servers.push(web);

    try {
      const status = await fetchJson(`${web.url}/api/status`);
      expect(status).toMatchObject({
        session: { id: "web-session" },
        shell: { enabled: false }
      });

      const memory = await postJson(`${web.url}/api/memory`, {
        content: "The UI session can store memory without leaking.",
        tags: ["ui"]
      });
      expect(memory).toMatchObject({ ok: true });

      const memories = await fetchJson(`${web.url}/api/memory?query=leaking`);
      expect(JSON.stringify(memories)).toContain("without leaking");

      const provider = await postJson(`${web.url}/api/provider/validate`, {
        kind: "openai-compatible",
        baseUrl: "http://localhost:1234/v1",
        modelId: "manual-id",
        apiKey: "secret",
        headers: {
          authorization: "Bearer header-secret",
          "x-api-key": "header-secret-2"
        }
      });
      expect(provider).toMatchObject({
        ok: true,
        config: {
          kind: "openai-compatible",
          apiKey: "[redacted]",
          headers: {
            authorization: "[redacted]",
            "x-api-key": "[redacted]"
          }
        }
      });
      expect(JSON.stringify(provider)).not.toContain("secret");
      expect(JSON.stringify(provider)).not.toContain("header-secret");
      expect(JSON.stringify(provider)).not.toContain("value");

      const shell = await postJson(`${web.url}/api/shell/run`, {
        command: process.execPath,
        args: ["-e", "console.log('blocked')"]
      });
      expect(shell).toMatchObject({ ok: false });
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  return response.json();
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return response.json();
}
