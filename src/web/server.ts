import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { URL } from "node:url";
import type { AddressInfo } from "node:net";
import { resolveSessionIdentity, type SessionIdentity } from "../orchestrator/session.js";
import { SessionMemoryStore } from "../memory/store.js";
import {
  createModelAdapterFromConfig,
  ProviderConfigSchema,
  redactProviderConfig,
  type ProviderConfig
} from "../models/provider-config.js";
import { ShellTools, type ShellPolicy } from "../tools/shell.js";
import { appCss, appJs, redactedProviderKind, renderIndexHtml } from "./assets.js";
import { sampleModelRequest } from "./sample-request.js";

export interface ForLoopWebServerOptions {
  readonly workspace?: string;
  readonly host?: string;
  readonly port?: number;
  readonly sessionId?: string;
  readonly providerConfig?: ProviderConfig;
  readonly shellPolicy?: ShellPolicy;
}

export interface ForLoopWebServer {
  readonly url: string;
  readonly server: Server;
  readonly session: SessionIdentity;
  close(): Promise<void>;
}

export async function createForLoopWebServer(options: ForLoopWebServerOptions = {}): Promise<ForLoopWebServer> {
  const workspace = resolve(options.workspace ?? process.cwd());
  const session = resolveSessionIdentity(options.sessionId);
  const memoryStore = await SessionMemoryStore.open({ workspace, session });
  const shellTools = new ShellTools(workspace, options.shellPolicy);
  let providerConfig = options.providerConfig;

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/") {
        sendText(response, 200, "text/html; charset=utf-8", renderIndexHtml());
        return;
      }
      if (request.method === "GET" && url.pathname === "/assets/app.css") {
        sendText(response, 200, "text/css; charset=utf-8", appCss);
        return;
      }
      if (request.method === "GET" && url.pathname === "/assets/app.js") {
        sendText(response, 200, "text/javascript; charset=utf-8", appJs);
        return;
      }
      if (request.method === "GET" && url.pathname === "/favicon.ico") {
        response.writeHead(204);
        response.end();
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/status") {
        sendJson(response, 200, {
          workspace,
          session,
          shell: shellTools.status(),
          provider: providerConfig ? redactProviderConfig(providerConfig) : undefined,
          providerKind: redactedProviderKind(providerConfig),
          memory: { dbPath: memoryStore.dbPath }
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/memory") {
        sendJson(response, 200, memoryStore.search(memoryQuery(url)));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/memory") {
        const body = await readJson(request);
        const parsed = rememberBody(body);
        if (!parsed.ok) {
          sendJson(response, 400, parsed);
          return;
        }
        sendJson(response, 200, { ok: true, record: memoryStore.remember(parsed.value) });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/provider/validate") {
        const result = validateProvider(await readJson(request));
        sendJson(response, result.ok ? 200 : 400, result.ok ? publicProviderResult(result) : result);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/provider/config") {
        const result = validateProvider(await readJson(request));
        if (result.ok) {
          providerConfig = result.value;
        }
        sendJson(response, result.ok ? 200 : 400, result.ok ? { ok: true, config: result.config } : result);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/provider/test") {
        const body = await readJson(request);
        const result = validateProvider(body);
        const config = result.ok ? result.value : providerConfig;
        if (!config) {
          sendJson(response, 400, { ok: false, error: "Provider config is required." });
          return;
        }
        const adapter = createModelAdapterFromConfig(config);
        const modelResult = await adapter.generate(sampleModelRequest(workspace));
        sendJson(response, 200, { ok: true, result: modelResult.raw });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/shell/run") {
        const body = await readJson(request);
        sendJson(response, 200, await shellTools.run(shellBody(body)));
        return;
      }
      sendJson(response, 404, { ok: false, error: "Route not found." });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4317;
  await new Promise<void>((resolveListen) => server.listen(port, host, resolveListen));
  const address = server.address() as AddressInfo;

  return {
    url: `http://${host}:${address.port}`,
    server,
    session,
    async close(): Promise<void> {
      memoryStore.close();
      await new Promise<void>((resolveClose, reject) => {
        server.close((error) => (error ? reject(error) : resolveClose()));
      });
    }
  };
}

function memoryQuery(url: URL): { query?: string; tag?: string; limit?: number } {
  const limit = url.searchParams.get("limit");
  return {
    query: url.searchParams.get("query") ?? undefined,
    tag: url.searchParams.get("tag") ?? undefined,
    limit: limit ? Number(limit) : undefined
  };
}

function rememberBody(body: unknown):
  | { readonly ok: true; readonly value: { readonly content: string; readonly tags: string[] } }
  | { readonly ok: false; readonly error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Memory body must be an object." };
  }
  const record = body as Record<string, unknown>;
  if (typeof record.content !== "string" || record.content.trim().length === 0) {
    return { ok: false, error: "Memory content is required." };
  }
  const tags = Array.isArray(record.tags)
    ? record.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
    : [];
  return { ok: true, value: { content: record.content, tags } };
}

function validateProvider(body: unknown):
  | { readonly ok: true; readonly value: ProviderConfig; readonly config: ProviderConfig }
  | { readonly ok: false; readonly error: string; readonly issues?: unknown } {
  const parsed = ProviderConfigSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Provider config is invalid.",
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
    };
  }
  return { ok: true, value: parsed.data, config: redactProviderConfig(parsed.data) };
}

function publicProviderResult(result: {
  readonly ok: true;
  readonly config: ProviderConfig;
}): { readonly ok: true; readonly config: ProviderConfig } {
  return { ok: true, config: result.config };
}

function shellBody(body: unknown): {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly mode?: "exec" | "shell";
  readonly timeoutMs?: number;
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { command: "" };
  }
  const record = body as Record<string, unknown>;
  const args = Array.isArray(record.args)
    ? record.args.filter((arg): arg is string => typeof arg === "string")
    : undefined;
  return {
    command: typeof record.command === "string" ? record.command : "",
    args,
    cwd: typeof record.cwd === "string" ? record.cwd : undefined,
    mode: record.mode === "shell" ? "shell" : "exec",
    timeoutMs: typeof record.timeoutMs === "number" ? record.timeoutMs : undefined
  };
}

function sendText(response: ServerResponse, status: number, contentType: string, body: string): void {
  response.writeHead(status, { "content-type": contentType });
  response.end(body);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function readJson(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolveRead, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      if (!body.trim()) {
        resolveRead({});
        return;
      }
      try {
        resolveRead(JSON.parse(body));
      } catch (error) {
        reject(new Error(`Request body was not valid JSON: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
    request.on("error", reject);
  });
}
