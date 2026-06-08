#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { z } from "zod";
import { RepoTools } from "../tools/repo.js";
import type { ToolResult } from "../orchestrator/schemas.js";

export interface RepoMcpServerOptions {
  allowMutations?: boolean;
  allowedTools?: string[];
}

export async function startRepoMcpServer(
  workspace = process.cwd(),
  testCommand = "npm test",
  typecheckCommandOrOptions?: string | RepoMcpServerOptions,
  options: RepoMcpServerOptions = {}
): Promise<void> {
  const typecheckCommand = typeof typecheckCommandOrOptions === "string" ? typecheckCommandOrOptions : undefined;
  const resolvedOptions = typeof typecheckCommandOrOptions === "object" ? typecheckCommandOrOptions : options;
  const repoTools = new RepoTools(workspace, testCommand, typecheckCommand);
  const server = new McpServer({
    name: "forloop-repo-tools",
    version: "0.1.6"
  });

  server.registerTool(
    "repo.list_files",
    {
      title: "List workspace files",
      description: "List files inside the workspace, excluding build and dependency directories.",
      inputSchema: { limit: z.number().int().positive().optional() }
    },
    async (args) => callAllowed(resolvedOptions, "repo.list_files", () => repoTools.listFiles(args))
  );

  server.registerTool(
    "repo.search_code",
    {
      title: "Search code",
      description: "Search text files inside the workspace for an exact string.",
      inputSchema: { query: z.string().min(1), limit: z.number().int().positive().optional() }
    },
    async (args) => callAllowed(resolvedOptions, "repo.search_code", () => repoTools.searchCode(args))
  );

  server.registerTool(
    "repo.read_file",
    {
      title: "Read file",
      description: "Read a UTF-8 text file inside the workspace.",
      inputSchema: { path: z.string().min(1), maxBytes: z.number().int().positive().optional() }
    },
    async (args) => callAllowed(resolvedOptions, "repo.read_file", () => repoTools.readFile(args))
  );

  server.registerTool(
    "repo.apply_patch",
    {
      title: "Apply patch",
      description: "Apply exact search/replace edits inside the workspace. The orchestrator should require approval first.",
      inputSchema: {
        edits: z.array(
          z.object({
            path: z.string().min(1),
            search: z.string().min(1),
            replace: z.string()
          })
        )
      }
    },
    async (args) => {
      if (!isAllowed(resolvedOptions, "repo.apply_patch")) {
        return asMcpResult(deniedTool("repo.apply_patch"));
      }
      if (!resolvedOptions.allowMutations) {
        return asMcpResult(deniedMutation("repo.apply_patch"));
      }
      return asMcpResult(await repoTools.applyPatch(args));
    }
  );

  server.registerTool(
    "repo.run_tests",
    {
      title: "Run tests",
      description: "Run only the configured test command.",
      inputSchema: { command: z.string().optional() }
    },
    async (args) => callAllowed(resolvedOptions, "repo.run_tests", () => repoTools.runTests(args))
  );

  server.registerTool(
    "repo.run_typecheck",
    {
      title: "Run typecheck",
      description: "Run only the configured typecheck command, when one is configured.",
      inputSchema: { command: z.string().optional() }
    },
    async (args) => callAllowed(resolvedOptions, "repo.run_typecheck", () => repoTools.runTypecheck(args))
  );

  server.registerTool(
    "repo.git_diff",
    {
      title: "Git diff",
      description: "Return git diff for the workspace when it is a git repository.",
      inputSchema: {}
    },
    async () => callAllowed(resolvedOptions, "repo.git_diff", () => repoTools.gitDiff())
  );

  await server.connect(new StdioServerTransport());
}

function asMcpResult(result: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2)
      }
    ]
  };
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
      allowedTools: readRepeatedArg("allowed-tool")
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

async function callAllowed(
  options: RepoMcpServerOptions,
  tool: string,
  run: () => Promise<ToolResult>
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  if (!isAllowed(options, tool)) {
    return asMcpResult(deniedTool(tool));
  }
  return asMcpResult(await run());
}

function isAllowed(options: RepoMcpServerOptions, tool: string): boolean {
  return !options.allowedTools || options.allowedTools.includes(tool);
}

function deniedTool(tool: string): ToolResult {
  return {
    tool,
    ok: false,
    error: `Tool is not allowed by this MCP server security policy: ${tool}`
  };
}

function deniedMutation(tool: string): ToolResult {
  return {
    tool,
    ok: false,
    error: "Direct MCP mutations are disabled by default. Restart with --allow-mutations to enable this tool."
  };
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
  --help, -h               Show this help text.
`);
}
