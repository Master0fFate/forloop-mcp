import { z } from "zod";
import type { ToolCallAction, ToolResult } from "../orchestrator/schemas.js";
import type { MemoryQuery, RememberMemoryInput, SessionMemoryStore } from "../memory/store.js";
import { RepoTools } from "./repo.js";
import { ShellTools, type ShellRunInput } from "./shell.js";

export interface ToolDescription {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  mutates: boolean;
}

export class RepoToolRegistry {
  private readonly tools: ToolDescription[];

  constructor(
    private readonly repoTools: RepoTools,
    private readonly memoryStore?: SessionMemoryStore,
    private readonly shellTools?: ShellTools
  ) {
    this.tools = [
    {
      name: "repo.list_files",
      description: "List files inside the workspace, excluding build and dependency directories.",
      inputSchema: z.object({ limit: z.number().int().positive().optional() }),
      mutates: false
    },
    {
      name: "repo.search_code",
      description: "Search text files inside the workspace for an exact string.",
      inputSchema: z.object({ query: z.string().min(1), limit: z.number().int().positive().optional() }),
      mutates: false
    },
    {
      name: "repo.read_file",
      description: "Read a UTF-8 text file inside the workspace.",
      inputSchema: z.object({ path: z.string().min(1), maxBytes: z.number().int().positive().optional() }),
      mutates: false
    },
    {
      name: "repo.apply_patch",
      description: "Apply exact search/replace edits inside the workspace. Requires approval.",
      inputSchema: z.object({
        edits: z.array(
          z.object({
            path: z.string().min(1),
            search: z.string().min(1),
            replace: z.string()
          })
        )
      }),
      mutates: true
    },
    {
      name: "repo.run_tests",
      description: "Run the configured test command only.",
      inputSchema: z.object({ command: z.string().optional() }),
      mutates: false
    },
    {
      name: "repo.run_typecheck",
      description: "Run the configured typecheck command only, when one is configured.",
      inputSchema: z.object({ command: z.string().optional() }),
      mutates: false
    },
    {
      name: "repo.git_diff",
      description: "Return git diff for the workspace when it is a git repository.",
      inputSchema: z.object({}),
      mutates: false
    },
    {
      name: "memory.remember",
      description: "Store a long-term memory in the current session namespace.",
      inputSchema: z.object({
        content: z.string().min(1),
        tags: z.array(z.string().min(1)).optional(),
        source: z.string().min(1).optional(),
        metadata: z.record(z.string(), z.unknown()).optional()
      }),
      mutates: true
    },
    {
      name: "memory.search",
      description: "Search long-term memories in the current session namespace only.",
      inputSchema: z.object({
        query: z.string().optional(),
        tag: z.string().optional(),
        limit: z.number().int().positive().optional()
      }),
      mutates: false
    },
    {
      name: "memory.list",
      description: "List long-term memories in the current session namespace only.",
      inputSchema: z.object({
        tag: z.string().optional(),
        limit: z.number().int().positive().optional()
      }),
      mutates: false
    },
    {
      name: "memory.delete",
      description: "Delete a long-term memory from the current session namespace.",
      inputSchema: z.object({ id: z.string().min(1) }),
      mutates: true
    },
    {
      name: "shell.status",
      description: "Inspect whether the current session allows shell execution.",
      inputSchema: z.object({}),
      mutates: false
    },
    {
      name: "shell.run",
      description: "Run a governed command in the workspace when shell tools are explicitly enabled.",
      inputSchema: z.object({
        command: z.string().min(1),
        args: z.array(z.string()).optional(),
        cwd: z.string().optional(),
        mode: z.enum(["exec", "shell"]).optional(),
        timeoutMs: z.number().int().positive().optional(),
        env: z.record(z.string(), z.string()).optional()
      }),
      mutates: true
    }
  ];
  }

  describe(): ToolDescription[] {
    return this.tools;
  }

  has(toolName: string): boolean {
    return this.tools.some((tool) => tool.name === toolName);
  }

  get(toolName: string): ToolDescription | undefined {
    return this.tools.find((tool) => tool.name === toolName);
  }

  requiresApproval(toolName: string): boolean {
    return this.tools.find((tool) => tool.name === toolName)?.mutates ?? true;
  }

  async call(action: ToolCallAction): Promise<ToolResult> {
    const description = this.tools.find((tool) => tool.name === action.tool);
    if (!description) {
      return { tool: action.tool, ok: false, error: `Unknown tool: ${action.tool}` };
    }

    const parsed = description.inputSchema.safeParse(action.args);
    if (!parsed.success) {
      return {
        tool: action.tool,
        ok: false,
        error: parsed.error.issues.map((issue) => issue.message).join("; ")
      };
    }

    try {
      switch (action.tool) {
        case "repo.list_files":
          return await this.repoTools.listFiles(parsed.data as { limit?: number });
        case "repo.search_code":
          return await this.repoTools.searchCode(parsed.data as { query: string; limit?: number });
        case "repo.read_file":
          return await this.repoTools.readFile(parsed.data as { path: string; maxBytes?: number });
        case "repo.apply_patch":
          return await this.repoTools.applyPatch(parsed.data);
        case "repo.run_tests":
          return await this.repoTools.runTests(parsed.data as { command?: string });
        case "repo.run_typecheck":
          return await this.repoTools.runTypecheck(parsed.data as { command?: string });
        case "repo.git_diff":
          return await this.repoTools.gitDiff();
        case "memory.remember":
          return this.callMemory(action.tool, () =>
            this.requireMemoryStore().remember(parsed.data as RememberMemoryInput)
          );
        case "memory.search":
          return this.callMemory(action.tool, () => this.requireMemoryStore().search(parsed.data as MemoryQuery));
        case "memory.list":
          return this.callMemory(action.tool, () => this.requireMemoryStore().list(parsed.data as MemoryQuery));
        case "memory.delete":
          return this.callMemory(action.tool, () => {
            const args = parsed.data as { id: string };
            return { deleted: this.requireMemoryStore().delete(args.id) };
          });
        case "shell.status":
          return { tool: action.tool, ok: true, output: this.requireShellTools().status() };
        case "shell.run":
          return await this.requireShellTools().run(parsed.data as ShellRunInput);
        default:
          return { tool: action.tool, ok: false, error: `Unhandled tool: ${action.tool}` };
      }
    } catch (error) {
      return {
        tool: action.tool,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private callMemory(tool: string, run: () => unknown): ToolResult {
    return { tool, ok: true, output: run() };
  }

  private requireMemoryStore(): SessionMemoryStore {
    if (!this.memoryStore) {
      throw new Error("Memory tools are not configured for this registry.");
    }
    return this.memoryStore;
  }

  private requireShellTools(): ShellTools {
    if (!this.shellTools) {
      throw new Error("Shell tools are not configured for this registry.");
    }
    return this.shellTools;
  }
}
