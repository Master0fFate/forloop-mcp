import type { SecurityDecisionResult, TaskInput, ToolCallAction, ToolResult } from "./schemas.js";
import type { ToolDescription } from "../tools/registry.js";

export class DeterministicSecurityGate {
  assessAction(task: TaskInput, action: ToolCallAction, tool: ToolDescription | undefined): SecurityDecisionResult {
    if (!tool) {
      return {
        action: "deny",
        boundary: "tool",
        reason: `Denied unknown tool: ${action.tool}`,
        metrics: { requestedTool: action.tool }
      };
    }

    if (!task.security.allowedTools.includes(action.tool)) {
      return {
        action: "deny",
        boundary: "tool",
        reason: `Denied unsanctioned tool: ${action.tool}`,
        metrics: { requestedTool: action.tool, allowedTools: task.security.allowedTools }
      };
    }

    if (tool.mutates && task.security.requireApprovalForMutations) {
      return {
        action: "escalate",
        boundary: "mutation",
        reason: `Mutating tool requires approval: ${action.tool}`,
        metrics: { requestedTool: action.tool }
      };
    }

    return {
      action: "allow",
      boundary: "policy",
      reason: "Action satisfies the configured security policy.",
      metrics: { requestedTool: action.tool }
    };
  }

  assessToolResult(result: ToolResult): SecurityDecisionResult | undefined {
    if (result.ok) {
      return undefined;
    }

    const error = result.error ?? "";
    if (error.includes("Path escapes workspace")) {
      return {
        action: "deny",
        boundary: "workspace",
        reason: error,
        metrics: { tool: result.tool }
      };
    }

    if (
      error.includes("Only the configured test command is allowed") ||
      error.includes("Only the configured typecheck command is allowed") ||
      error.includes("Command is not allowed by shell policy") ||
      error.includes("Shell tools are disabled by default")
    ) {
      return {
        action: "deny",
        boundary: "command",
        reason: error,
        metrics: { tool: result.tool }
      };
    }

    if (error.includes("working directory escapes workspace")) {
      return {
        action: "deny",
        boundary: "workspace",
        reason: error,
        metrics: { tool: result.tool }
      };
    }

    return undefined;
  }
}
