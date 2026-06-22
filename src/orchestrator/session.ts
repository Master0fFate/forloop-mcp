import { createHash, randomUUID } from "node:crypto";

const sessionEnvKeys = [
  "FORLOOP_SESSION_ID",
  "CODEX_SESSION_ID",
  "CODEX_THREAD_ID",
  "CODEX_CONVERSATION_ID",
  "CLAUDECODE_SESSION_ID",
  "CLAUDE_CODE_SESSION_ID",
  "MCP_SESSION_ID"
] as const;

export interface SessionIdentity {
  readonly id: string;
  readonly storageName: string;
}

export function resolveSessionIdentity(explicitSessionId?: string, fallbackId: string = randomUUID()): SessionIdentity {
  const id = firstNonEmpty([explicitSessionId, ...sessionEnvKeys.map((key) => process.env[key])]) ?? `ephemeral-${fallbackId}`;
  return {
    id,
    storageName: toStorageName(id)
  };
}

function firstNonEmpty(values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

function toStorageName(value: string): string {
  const hash = createHash("sha256").update(value).digest("hex").slice(0, 12);
  const readable = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${readable || "session"}-${hash}`;
}
