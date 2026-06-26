import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import YAML from "yaml";
import type { ShellPolicy } from "../tools/shell.js";
import { TaskInputSchema, type TaskInput } from "../orchestrator/schemas.js";

type UnknownOptions = Readonly<Record<string, unknown>>;

export async function loadTask(options: UnknownOptions): Promise<TaskInput> {
  const yamlTask = typeof options.task === "string" ? await readYamlTask(resolve(options.task)) : {};
  const workspace = String(options.workspace ?? yamlTask.workspace ?? ".");
  const approvalMode = options.autoApprove ? "auto" : options.denyApproval ? "deny" : yamlTask.approvalMode;

  return TaskInputSchema.parse({
    ...yamlTask,
    goal: options.goal ?? yamlTask.goal,
    workspace,
    skill: options.skill ?? yamlTask.skill,
    model: options.model ?? yamlTask.model,
    testCommand: options.testCommand ?? yamlTask.testCommand,
    typecheckCommand: options.typecheckCommand ?? yamlTask.typecheckCommand,
    approvalMode,
    sessionId: options.sessionId ?? yamlTask.sessionId,
    traceDbPath: options.traceDb ?? yamlTask.traceDbPath,
    budget: {
      ...(typeof yamlTask.budget === "object" && yamlTask.budget ? yamlTask.budget : {}),
      maxIterations: options.maxIterations ?? (yamlTask.budget as { maxIterations?: unknown } | undefined)?.maxIterations
    }
  });
}

export function shellPolicyFromOptions(options: UnknownOptions): ShellPolicy {
  return {
    enabled: options.allowShell === true,
    allowArbitrary: options.allowArbitraryShell === true,
    allowShellMode: options.allowShellMode === true,
    allowedCommands: stringArray(options.shellCommand)
  };
}

export function stringOption(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }
  return typeof value === "string" && value.trim() ? [value] : [];
}

async function readYamlTask(path: string): Promise<Record<string, unknown>> {
  if (!existsSync(path)) {
    throw new Error(`Task file not found: ${path}`);
  }
  const parsed = YAML.parse(await readFile(path, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Task file must contain a YAML object: ${path}`);
  }
  return parsed as Record<string, unknown>;
}
