import type { ModelAdapter } from "../models/base.js";
import type { SQLiteStateStore } from "../storage/sqlite.js";
import type { ShellPolicy } from "../tools/shell.js";
import type { ApprovalManager } from "./approval.js";

export interface RunAgentLoopOptions {
  model?: ModelAdapter;
  approvalManager?: ApprovalManager;
  skillsDir?: string;
  stateStore?: SQLiteStateStore;
  shellPolicy?: ShellPolicy;
}
