#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { SessionMemoryStore } from "../memory/store.js";
import { resolveSessionIdentity } from "../orchestrator/session.js";
import { ShellTools } from "../tools/shell.js";
import { RepoToolRegistry } from "../tools/registry.js";
import { RepoTools } from "../tools/repo.js";
import { registerRegistryTools, registerRepoTools } from "./register-tools.js";
import type { RepoMcpServerOptions } from "./server-options.js";

export type { RepoMcpServerOptions } from "./server-options.js";

export async function startRepoMcpServer(
  workspace = process.cwd(),
  testCommand = "npm test",
  typecheckCommandOrOptions?: string | RepoMcpServerOptions,
  options: RepoMcpServerOptions = {}
): Promise<void> {
  const typecheckCommand = typeof typecheckCommandOrOptions === "string" ? typecheckCommandOrOptions : undefined;
  const resolvedOptions = typeof typecheckCommandOrOptions === "object" ? typecheckCommandOrOptions : options;
  const session = resolveSessionIdentity(resolvedOptions.sessionId);
  const repoTools = new RepoTools(workspace, testCommand, typecheckCommand);
  const server = new McpServer({
    name: `forloop-repo-tools-${session.storageName}`,
    version: "0.1.9"
  });

  registerRepoTools(server, repoTools, resolvedOptions);

  const memoryStore = await SessionMemoryStore.open({ workspace: repoTools.workspace, session });
  const shellTools = new ShellTools(repoTools.workspace, {
    enabled: resolvedOptions.allowShell === true,
    allowArbitrary: resolvedOptions.allowArbitraryShell === true,
    allowShellMode: resolvedOptions.allowShellMode === true,
    allowedCommands: resolvedOptions.shellAllowedCommands ?? []
  });
  const registry = new RepoToolRegistry(repoTools, memoryStore, shellTools);
  registerRegistryTools(server, registry, resolvedOptions);

  await server.connect(new StdioServerTransport());
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (hasFlag("help") || hasFlag("h")) {
    printUsage();
    process.exit(0);
  }

  await startRepoMcpServer(
    readArg("workspace", process.cwd()),
    readArg("test-command", "npm test"),
    readArg("typecheck-command"),
    {
      allowMutations: hasFlag("allow-mutations"),
      allowShell: hasFlag("allow-shell"),
      allowArbitraryShell: hasFlag("allow-arbitrary-shell"),
      allowShellMode: hasFlag("allow-shell-mode"),
      shellAllowedCommands: readRepeatedArg("shell-command"),
      allowedTools: readRepeatedArg("allowed-tool"),
      sessionId: readArg("session-id")
    }
  );
}

function readArg(name: string, fallback: string): string;
function readArg(name: string): string | undefined;
function readArg(name: string, fallback?: string): string | undefined {
  const flag = `--${name}`;
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === flag) {
      return process.argv[index + 1] ?? fallback;
    }
    if (arg?.startsWith(`${flag}=`)) {
      return arg.slice(flag.length + 1);
    }
  }
  return fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`) || (name.length === 1 && process.argv.includes(`-${name}`));
}

function readRepeatedArg(name: string): string[] | undefined {
  const flag = `--${name}`;
  const values: string[] = [];
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === flag && process.argv[index + 1]) {
      values.push(process.argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg?.startsWith(`${flag}=`)) {
      values.push(arg.slice(flag.length + 1));
    }
  }
  return values.length > 0 ? values : undefined;
}

function printUsage(): void {
  console.log(`ForLoop MCP repo server

Usage:
  forloop-mcp --workspace <path> --test-command <command> [--allow-mutations]

Examples:
  forloop-mcp --workspace /absolute/path/to/repo --test-command "npm test"
  npx -y forloop-mcp@latest --workspace /absolute/path/to/repo --test-command "npm test"

Options:
  --workspace <path>       Repository workspace the MCP tools may access.
  --test-command <command> Test command allowed through repo.run_tests.
  --typecheck-command <command>
                           Optional command allowed through repo.run_typecheck.
  --allowed-tool <name>    Restrict MCP calls to repeated allowed tool names.
  --allow-mutations        Enable direct MCP repo.apply_patch calls.
  --allow-shell            Enable governed shell.run calls.
  --allow-arbitrary-shell  Allow shell.run commands beyond repeated --shell-command values.
  --allow-shell-mode       Allow shell.run mode=shell in addition to structured exec args.
  --shell-command <path>   Permit one executable when shell is enabled. Repeatable.
  --session-id <id>        Stable session id for this MCP server instance.
  --help, -h               Show this help text.
`);
}
