import type { RepoToolRegistry } from "../tools/registry.js";
import type { ToolResult } from "../orchestrator/schemas.js";
import type { RepoMcpServerOptions } from "./server-options.js";

export type McpTextResult = {
  readonly content: Array<{ readonly type: "text"; readonly text: string }>;
};

export function asMcpResult(result: unknown): McpTextResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2)
      }
    ]
  };
}

export async function callAllowed(
  options: RepoMcpServerOptions,
  tool: string,
  run: () => Promise<ToolResult>
): Promise<McpTextResult> {
  if (!isAllowed(options, tool)) {
    return asMcpResult(deniedTool(tool));
  }
  return asMcpResult(await run());
}

export function isAllowed(options: RepoMcpServerOptions, tool: string): boolean {
  return !options.allowedTools || options.allowedTools.includes(tool);
}

export async function callRegistry(
  options: RepoMcpServerOptions,
  registry: RepoToolRegistry,
  tool: string,
  args: Record<string, unknown>
): Promise<McpTextResult> {
  if (!isAllowed(options, tool)) {
    return asMcpResult(deniedTool(tool));
  }
  return asMcpResult(await registry.call({ type: "tool_call", tool, args }));
}

export function deniedTool(tool: string): ToolResult {
  return {
    tool,
    ok: false,
    error: `Tool is not allowed by this MCP server security policy: ${tool}`
  };
}

export function deniedMutation(tool: string): ToolResult {
  return {
    tool,
    ok: false,
    error: "Direct MCP mutations are disabled by default. Restart with --allow-mutations to enable this tool."
  };
}
