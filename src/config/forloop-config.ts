import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { ProviderConfigSchema } from "../models/provider-config.js";
import type { ShellPolicy } from "../tools/shell.js";

export const ShellPolicyConfigSchema = z.object({
  enabled: z.boolean().default(false),
  allowArbitrary: z.boolean().default(false),
  allowShellMode: z.boolean().default(false),
  allowedCommands: z.array(z.string().min(1)).default([]),
  timeoutMs: z.coerce.number().int().positive().default(30000),
  maxOutputBytes: z.coerce.number().int().positive().default(12000)
});

export const WebConfigSchema = z.object({
  host: z.string().min(1).default("127.0.0.1"),
  port: z.coerce.number().int().min(0).max(65535).default(4317)
});

export const ForLoopConfigSchema = z.object({
  provider: ProviderConfigSchema.optional(),
  shell: ShellPolicyConfigSchema.default({
    enabled: false,
    allowArbitrary: false,
    allowShellMode: false,
    allowedCommands: [],
    timeoutMs: 30000,
    maxOutputBytes: 12000
  }),
  web: WebConfigSchema.default({ host: "127.0.0.1", port: 4317 })
});

export type ForLoopConfig = z.infer<typeof ForLoopConfigSchema>;

export async function loadForLoopConfig(options: {
  readonly workspace: string;
  readonly configPath?: string;
}): Promise<ForLoopConfig> {
  const path = options.configPath ? resolve(options.configPath) : resolve(options.workspace, ".forloop", "config.yaml");
  if (!existsSync(path)) {
    return ForLoopConfigSchema.parse({});
  }

  const content = await readFile(path, "utf8");
  const parsed = YAML.parse(content);
  return ForLoopConfigSchema.parse(parsed ?? {});
}

export function defaultConfigPath(workspace: string): string {
  return join(resolve(workspace), ".forloop", "config.yaml");
}

export function mergeShellPolicy(configPolicy: ShellPolicy, override: ShellPolicy = {}): ShellPolicy {
  return {
    ...configPolicy,
    ...override,
    allowedCommands: override.allowedCommands ?? configPolicy.allowedCommands
  };
}
