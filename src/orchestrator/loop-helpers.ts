import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { TaskEvent, TaskInput } from "./schemas.js";
import { resolveSessionIdentity, type SessionIdentity } from "./session.js";

export type WorkspaceStatus = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface TraceContext {
  readonly workspace: string;
  readonly session: SessionIdentity;
  readonly workspaceStatus: WorkspaceStatus;
  readonly traceDbPath: string;
}

interface TracePathInput {
  readonly task: TaskInput;
  readonly workspace: string;
  readonly taskId: string;
  readonly sessionStorageName: string;
  readonly workspaceStatus: WorkspaceStatus;
}

export function createTraceContext(task: TaskInput, taskId: string): TraceContext {
  const workspace = resolve(task.workspace);
  const session = resolveSessionIdentity(task.sessionId, taskId);
  const workspaceStatus = inspectWorkspace(workspace);
  return {
    workspace,
    session,
    workspaceStatus,
    traceDbPath: chooseTraceDbPath({ task, workspace, taskId, sessionStorageName: session.storageName, workspaceStatus })
  };
}

export function summarizeEvents(events: readonly TaskEvent[]): string {
  return events
    .slice(-10)
    .map((event) => `${event.type}: ${JSON.stringify(event.payload).slice(0, 500)}`)
    .join("\n");
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function approximateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4);
}

export function deterministicVerifierMetadata(task: TaskInput): { readonly kind: "deterministic"; readonly checks: string[] } {
  const checks = ["tool_schema", "security_policy", "workspace_policy"];
  if (task.quality.requireTestsPassed) {
    checks.push("configured_tests");
  }
  if (task.quality.requireTypecheckPassed) {
    checks.push("configured_typecheck");
  }
  return { kind: "deterministic", checks };
}

function inspectWorkspace(workspace: string): WorkspaceStatus {
  if (!existsSync(workspace)) {
    return { ok: false, reason: `Workspace does not exist: ${workspace}` };
  }

  try {
    if (!statSync(workspace).isDirectory()) {
      return { ok: false, reason: `Workspace is not a directory: ${workspace}` };
    }
  } catch (error) {
    return { ok: false, reason: `Workspace could not be inspected: ${errorMessage(error)}` };
  }

  return { ok: true };
}

function chooseTraceDbPath(input: TracePathInput): string {
  if (input.task.traceDbPath) {
    const requestedTraceDbPath = resolve(input.task.traceDbPath);
    return join(dirname(requestedTraceDbPath), "sessions", input.sessionStorageName, basename(requestedTraceDbPath));
  }

  if (input.workspaceStatus.ok) {
    return join(input.workspace, ".forloop", "sessions", input.sessionStorageName, "state.sqlite");
  }

  return join(tmpdir(), "forloop", "sessions", input.sessionStorageName, `${input.taskId}.sqlite`);
}
