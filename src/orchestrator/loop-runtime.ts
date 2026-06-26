import { createModelAdapter } from "../models/router.js";
import { SessionMemoryStore } from "../memory/store.js";
import { defaultSkillsDir, SkillLoader } from "../skills/loader.js";
import { RepoTools } from "../tools/repo.js";
import { RepoToolRegistry } from "../tools/registry.js";
import { ShellTools } from "../tools/shell.js";
import { PolicyApprovalManager } from "./approval.js";
import { DeterministicEvaluator } from "./evaluator.js";
import { DeterministicGovernance } from "./governance.js";
import { type RunAgentLoopOptions } from "./loop-options.js";
import { DeterministicSecurityGate } from "./security.js";
import type { TaskInput } from "./schemas.js";
import type { SessionIdentity } from "./session.js";

export interface LoopRuntime {
  readonly approvalManager: PolicyApprovalManager | NonNullable<RunAgentLoopOptions["approvalManager"]>;
  readonly evaluator: DeterministicEvaluator;
  readonly governance: DeterministicGovernance;
  readonly model: NonNullable<RunAgentLoopOptions["model"]>;
  readonly registry: RepoToolRegistry;
  readonly security: DeterministicSecurityGate;
  readonly skillLoader: SkillLoader;
  close(): void;
}

export async function createLoopRuntime(
  task: TaskInput,
  options: RunAgentLoopOptions,
  workspace: string,
  session: SessionIdentity
): Promise<LoopRuntime> {
  const skillLoader = new SkillLoader(options.skillsDir ?? defaultSkillsDir(process.cwd()));
  const model = options.model ?? createModelAdapter(task.model);
  const approvalManager = options.approvalManager ?? new PolicyApprovalManager();
  const evaluator = new DeterministicEvaluator();
  const governance = new DeterministicGovernance();
  const security = new DeterministicSecurityGate();
  const memoryStore = await SessionMemoryStore.open({ workspace, session });
  const repoTools = new RepoTools(workspace, task.testCommand, task.typecheckCommand);
  const shellTools = new ShellTools(workspace, options.shellPolicy);
  const registry = new RepoToolRegistry(repoTools, memoryStore, shellTools);

  return {
    approvalManager,
    evaluator,
    governance,
    model,
    registry,
    security,
    skillLoader,
    close(): void {
      memoryStore.close();
    }
  };
}
