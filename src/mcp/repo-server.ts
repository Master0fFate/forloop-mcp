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
}

export async function startRepoMcpServer(
  workspace = process.cwd(),
  testCommand = "npm test",
  options: RepoMcpServerOptions = {}
): Promise<void> {
  const repoTools = new RepoTools(workspace, testCommand);
  const server = new McpServer({
    name: "forloop-repo-tools",
    version: "0.1.2"
  });

  server.registerTool(
    "repo.list_files",
    {
      title: "List workspace files",
      description: "List files inside the workspace, excluding build and dependency directories.",
      inputSchema: { limit: z.number().int().positive().optional() }
    },
    async (args) => asMcpResult(await repoTools.listFiles(args))
  );

  server.registerTool(
    "repo.search_code",
    {
      title: "Search code",
      description: "Search text files inside the workspace for an exact string.",
      inputSchema: { query: z.string().min(1), limit: z.number().int().positive().optional() }
    },
    async (args) => asMcpResult(await repoTools.searchCode(args))
  );

  server.registerTool(
    "repo.read_file",
    {
      title: "Read file",
      description: "Read a UTF-8 text file inside the workspace.",
      inputSchema: { path: z.string().min(1), maxBytes: z.number().int().positive().optional() }
    },
    async (args) => asMcpResult(await repoTools.readFile(args))
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
      if (!options.allowMutations) {
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
    async (args) => asMcpResult(await repoTools.runTests(args))
  );

  server.registerTool(
    "repo.git_diff",
    {
      title: "Git diff",
      description: "Return git diff for the workspace when it is a git repository.",
      inputSchema: {}
    },
    async () => asMcpResult(await repoTools.gitDiff())
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

  await startRepoMcpServer(readArg("workspace", process.cwd()), readArg("test-command", "npm test"), {
    allowMutations: hasFlag("allow-mutations")
  });
}

function readArg(name: string, fallback: string): string {
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
  --allow-mutations        Enable direct MCP repo.apply_patch calls.
  --help, -h               Show this help text.
`);
}
