import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { RepoToolRegistry } from "../tools/registry.js";
import type { RepoTools } from "../tools/repo.js";
import { asMcpResult, callAllowed, callRegistry, deniedMutation, deniedTool, isAllowed } from "./server-helpers.js";
import type { RepoMcpServerOptions } from "./server-options.js";

export function registerRepoTools(server: McpServer, repoTools: RepoTools, options: RepoMcpServerOptions): void {
  server.registerTool(
    "repo.list_files",
    {
      title: "List workspace files",
      description: "List files inside the workspace, excluding build and dependency directories.",
      inputSchema: { limit: z.number().int().positive().optional() }
    },
    async (args) => callAllowed(options, "repo.list_files", () => repoTools.listFiles(args))
  );

  server.registerTool(
    "repo.search_code",
    {
      title: "Search code",
      description: "Search text files inside the workspace for an exact string.",
      inputSchema: { query: z.string().min(1), limit: z.number().int().positive().optional() }
    },
    async (args) => callAllowed(options, "repo.search_code", () => repoTools.searchCode(args))
  );

  server.registerTool(
    "repo.read_file",
    {
      title: "Read file",
      description: "Read a UTF-8 text file inside the workspace.",
      inputSchema: { path: z.string().min(1), maxBytes: z.number().int().positive().optional() }
    },
    async (args) => callAllowed(options, "repo.read_file", () => repoTools.readFile(args))
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
      if (!isAllowed(options, "repo.apply_patch")) {
        return asMcpResult(deniedTool("repo.apply_patch"));
      }
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
    async (args) => callAllowed(options, "repo.run_tests", () => repoTools.runTests(args))
  );

  server.registerTool(
    "repo.run_typecheck",
    {
      title: "Run typecheck",
      description: "Run only the configured typecheck command, when one is configured.",
      inputSchema: { command: z.string().optional() }
    },
    async (args) => callAllowed(options, "repo.run_typecheck", () => repoTools.runTypecheck(args))
  );

  server.registerTool(
    "repo.git_diff",
    {
      title: "Git diff",
      description: "Return git diff for the workspace when it is a git repository.",
      inputSchema: {}
    },
    async () => callAllowed(options, "repo.git_diff", () => repoTools.gitDiff())
  );
}

export function registerRegistryTools(
  server: McpServer,
  registry: RepoToolRegistry,
  options: RepoMcpServerOptions
): void {
  server.registerTool(
    "memory.remember",
    {
      title: "Remember",
      description: "Store a long-term memory in this MCP session namespace.",
      inputSchema: {
        content: z.string().min(1),
        tags: z.array(z.string().min(1)).optional(),
        source: z.string().min(1).optional(),
        metadata: z.record(z.string(), z.unknown()).optional()
      }
    },
    async (args) => callRegistry(options, registry, "memory.remember", args)
  );

  server.registerTool(
    "memory.search",
    {
      title: "Search memory",
      description: "Search long-term memories in this MCP session namespace only.",
      inputSchema: {
        query: z.string().optional(),
        tag: z.string().optional(),
        limit: z.number().int().positive().optional()
      }
    },
    async (args) => callRegistry(options, registry, "memory.search", args)
  );

  server.registerTool(
    "memory.list",
    {
      title: "List memory",
      description: "List long-term memories in this MCP session namespace only.",
      inputSchema: {
        tag: z.string().optional(),
        limit: z.number().int().positive().optional()
      }
    },
    async (args) => callRegistry(options, registry, "memory.list", args)
  );

  server.registerTool(
    "memory.delete",
    {
      title: "Delete memory",
      description: "Delete a long-term memory from this MCP session namespace.",
      inputSchema: { id: z.string().min(1) }
    },
    async (args) => callRegistry(options, registry, "memory.delete", args)
  );

  server.registerTool(
    "shell.status",
    {
      title: "Shell status",
      description: "Inspect whether shell execution is enabled for this MCP server.",
      inputSchema: {}
    },
    async (args) => callRegistry(options, registry, "shell.status", args)
  );

  server.registerTool(
    "shell.run",
    {
      title: "Run shell command",
      description: "Run a governed workspace command only when this MCP server was started with shell enablement.",
      inputSchema: {
        command: z.string().min(1),
        args: z.array(z.string()).optional(),
        cwd: z.string().optional(),
        mode: z.enum(["exec", "shell"]).optional(),
        timeoutMs: z.number().int().positive().optional(),
        env: z.record(z.string(), z.string()).optional()
      }
    },
    async (args) => callRegistry(options, registry, "shell.run", args)
  );
}
