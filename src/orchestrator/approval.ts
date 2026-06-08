import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { AgentDecision, ApprovalResult, TaskInput } from "./schemas.js";

export interface ApprovalManager {
  request(decision: AgentDecision, task: TaskInput): Promise<ApprovalResult>;
}

export class PolicyApprovalManager implements ApprovalManager {
  async request(decision: AgentDecision, task: TaskInput): Promise<ApprovalResult> {
    if (task.approvalMode === "auto") {
      return { approved: true, mode: "auto", reason: "Auto-approved by task policy." };
    }

    if (task.approvalMode === "deny") {
      return { approved: false, mode: "deny", reason: "Denied by task policy." };
    }

    const action = decision.next_action;
    const label = action ? `${action.tool} ${JSON.stringify(action.args)}` : decision.summary;
    const rl = createInterface({ input, output });
    try {
      const answer = await rl.question(`Approve ${label}? [y/N] `);
      const approved = answer.trim().toLowerCase() === "y";
      return {
        approved,
        mode: "manual",
        reason: approved ? "Approved interactively." : "Denied interactively."
      };
    } finally {
      rl.close();
    }
  }
}
