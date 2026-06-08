import { z } from "zod";
import type { ToolCallAction, ToolResult } from "../orchestrator/schemas.js";
import { RepoTools } from "./repo.js";

export interface ToolDescription {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  mutates: boolean;
}

export class RepoToolRegistry {
  private readonly tools: ToolDescription[] = [
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
      name: "repo.git_diff",
      description: "Return git diff for the workspace when it is a git repository.",
      inputSchema: z.object({}),
      mutates: false
    }
  ];

  constructor(private readonly repoTools: RepoTools) {}

  describe(): ToolDescription[] {
    return this.tools;
  }

  has(toolName: string): boolean {
    return this.tools.some((tool) => tool.name === toolName);
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
        case "repo.git_diff":
          return await this.repoTools.gitDiff();
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
}
