import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { parseAgentDecision } from "./decision.js";
import { DeterministicEvaluator } from "./evaluator.js";
import { DeterministicGovernance } from "./governance.js";
import { DeterministicSecurityGate } from "./security.js";
import { PolicyApprovalManager, type ApprovalManager } from "./approval.js";
import { TaskInputSchema, type TaskEvent, type TaskInput, type TaskResult } from "./schemas.js";
import type { ModelAdapter, ModelResponse } from "../models/base.js";
import { createModelAdapter } from "../models/router.js";
import { defaultSkillsDir, SkillLoader, type LoadedSkill } from "../skills/loader.js";
import { SQLiteStateStore } from "../storage/sqlite.js";
import { RepoTools } from "../tools/repo.js";
import { RepoToolRegistry } from "../tools/registry.js";

export interface RunAgentLoopOptions {
  model?: ModelAdapter;
  approvalManager?: ApprovalManager;
  skillsDir?: string;
  stateStore?: SQLiteStateStore;
}

export async function runAgentLoop(input: unknown, options: RunAgentLoopOptions = {}): Promise<TaskResult> {
  const task = TaskInputSchema.parse(input);
  const workspace = resolve(task.workspace);
  const taskId = randomUUID();
  const workspaceStatus = inspectWorkspace(workspace);
  const traceDbPath = chooseTraceDbPath(task, workspace, taskId, workspaceStatus);
  const store = options.stateStore ?? (await SQLiteStateStore.open(traceDbPath));
  const shouldCloseStore = !options.stateStore;
  const skillLoader = new SkillLoader(options.skillsDir ?? defaultSkillsDir(process.cwd()));
  const model = options.model ?? createModelAdapter(task.model);
  const approvalManager = options.approvalManager ?? new PolicyApprovalManager();
  const repoTools = new RepoTools(workspace, task.testCommand, task.typecheckCommand);
  const registry = new RepoToolRegistry(repoTools);
  const evaluator = new DeterministicEvaluator();
  const governance = new DeterministicGovernance();
  const security = new DeterministicSecurityGate();

  try {
    store.append(taskId, "task_created", { task: { ...task, workspace }, traceDbPath });

    if (!workspaceStatus.ok) {
      store.append(taskId, "task_failed", { reason: workspaceStatus.reason });
      return finish("failed");
    }

    let skill: LoadedSkill;
    try {
      skill = await skillLoader.load(task.skill);
    } catch (error) {
      store.append(taskId, "skill_load_failed", { error: errorMessage(error), skill: task.skill });
      store.append(taskId, "task_failed", { reason: `Skill could not be loaded: ${task.skill}` });
      return finish("failed");
    }

    store.append(taskId, "skill_loaded", { name: skill.name, path: skill.path });
    store.append(taskId, "model_selected", { provider: model.provider, model: model.model });
    store.append(taskId, "tools_loaded", { tools: registry.describe().map((tool) => tool.name) });

    let invalidDecisionCount = 0;
    let emptyRoundCount = 0;
    let approxTokens = 0;
    const actionCounts = new Map<string, number>();

    for (let iteration = 1; iteration <= task.budget.maxIterations; iteration += 1) {
      const events = store.list(taskId);
      if (task.budget.maxApproxTokens && approxTokens >= task.budget.maxApproxTokens) {
        const tokenGovernance = governance.assessTokenBudget(task, events, approxTokens);
        store.append(taskId, "governance_decision", { phase: "budget", decision: tokenGovernance });
        store.append(taskId, "task_abandoned", { reason: tokenGovernance.reason });
        return finish("abandoned");
      }

      store.append(taskId, "iteration_started", { iteration });

      let response: ModelResponse;
      try {
        response = await model.generate({
          task,
          skill,
          tools: registry.describe(),
          events,
          stateSummary: summarizeEvents(events)
        });
      } catch (error) {
        store.append(taskId, "model_error", { provider: model.provider, model: model.model, error: errorMessage(error) });
        store.append(taskId, "task_failed", { reason: "Model execution failed." });
        return finish("failed");
      }

      store.append(taskId, "model_response", {
        provider: response.provider,
        model: response.model,
        raw: response.raw
      });
      approxTokens += approximateTokens(response.raw);
      store.append(taskId, "budget_eval", {
        iteration,
        approxTokens,
        maxApproxTokens: task.budget.maxApproxTokens
      });
      if (task.budget.maxApproxTokens && approxTokens >= task.budget.maxApproxTokens) {
        const tokenGovernance = governance.assessTokenBudget(task, store.list(taskId), approxTokens);
        store.append(taskId, "governance_decision", { phase: "budget", decision: tokenGovernance });
        store.append(taskId, "task_abandoned", { reason: tokenGovernance.reason });
        return finish("abandoned");
      }

      const parsed = parseAgentDecision(response.raw);
      if (!parsed.ok) {
        invalidDecisionCount += 1;
        store.append(taskId, "invalid_model_output", { error: parsed.error, invalidDecisionCount });
        if (invalidDecisionCount > task.budget.maxInvalidDecisions) {
          store.append(taskId, "task_failed", { reason: "Too many invalid model decisions." });
          return finish("failed");
        }
        continue;
      }

      invalidDecisionCount = 0;
      const decision = parsed.decision;
      store.append(taskId, "decision_parsed", { decision });

      if (decision.status === "failed") {
        store.append(taskId, "task_failed", { reason: decision.summary });
        return finish("failed");
      }

      const preActionGovernance =
        decision.status === "final" ? undefined : governance.assessDecision(task, decision, store.list(taskId));
      if (preActionGovernance && preActionGovernance.action !== "continue") {
        store.append(taskId, "governance_decision", { phase: "decision", decision: preActionGovernance });
      }

      if (decision.status === "needs_human" && !decision.next_action) {
        store.append(taskId, "task_stopped_by_human", { reason: "Model requested human input." });
        return finish("stopped_by_human");
      }

      if (decision.status === "final") {
        const finalEval = evaluator.evaluateFinal(task, decision, store.list(taskId));
        store.append(taskId, "final_eval", { evaluation: finalEval });
        store.append(taskId, "quality_eval", {
          phase: "final",
          verifier: deterministicVerifierMetadata(task),
          evaluation: finalEval,
          criteria: task.quality
        });
        if (finalEval.pass) {
          store.append(taskId, "task_completed", { finalAnswer: decision.final_answer });
          return finish("completed", decision.final_answer);
        }
        store.append(taskId, "final_rejected", { feedback: finalEval.feedback });
        emptyRoundCount += 1;
        store.append(taskId, "empty_round", { reason: "Final answer failed evaluation criteria.", emptyRoundCount });
        if (emptyRoundCount > task.budget.maxEmptyRounds) {
          const emptyGovernance = governance.assessEmptyRounds(task, store.list(taskId));
          store.append(taskId, "governance_decision", { phase: "empty_round", decision: emptyGovernance });
          store.append(taskId, "task_abandoned", { reason: emptyGovernance.reason });
          return finish("abandoned");
        }
        const finalGovernance = governance.assessFinalRejection(task, finalEval, store.list(taskId));
        store.append(taskId, "governance_decision", { phase: "final", decision: finalGovernance });
        if (finalGovernance.action === "abandon") {
          store.append(taskId, "task_abandoned", { reason: finalGovernance.reason });
          return finish("abandoned");
        }
        continue;
      }

      const action = decision.next_action;
      if (!action) {
        store.append(taskId, "task_failed", { reason: "Decision had no executable action." });
        return finish("failed");
      }

      const toolDescription = registry.get(action.tool);
      const securityDecision = security.assessAction(task, action, toolDescription);
      store.append(taskId, "security_eval", { phase: "pre_action", action, decision: securityDecision });
      if (securityDecision.action === "deny") {
        store.append(taskId, "tool_denied", { action, reason: securityDecision.reason });
        store.append(taskId, "task_failed", { reason: securityDecision.reason, action });
        return finish("failed");
      }

      const actionKey = `${action.tool}:${JSON.stringify(action.args)}`;
      const actionCount = (actionCounts.get(actionKey) ?? 0) + 1;
      actionCounts.set(actionKey, actionCount);
      if (actionCount > task.budget.maxRepeatedActions) {
        store.append(taskId, "task_failed", { reason: "Repeated action limit exceeded.", action });
        return finish("failed");
      }

      if (
        securityDecision.action === "escalate" ||
        preActionGovernance?.action === "escalate" ||
        decision.requires_human_approval ||
        registry.requiresApproval(action.tool)
      ) {
        store.append(taskId, "approval_requested", { decision });
        const approval = await approvalManager.request(decision, task);
        store.append(taskId, "approval_result", { approval });
        if (!approval.approved) {
          store.append(taskId, "task_stopped_by_human", { reason: approval.reason });
          return finish("stopped_by_human");
        }
      }

      store.append(taskId, "tool_call", { action });
      const result = await registry.call(action);
      store.append(taskId, "tool_result", { result });
      if (result.ok) {
        emptyRoundCount = 0;
      } else {
        emptyRoundCount += 1;
        store.append(taskId, "empty_round", { reason: result.error ?? "Tool failed.", emptyRoundCount });
        if (emptyRoundCount > task.budget.maxEmptyRounds) {
          const emptyGovernance = governance.assessEmptyRounds(task, store.list(taskId));
          store.append(taskId, "governance_decision", { phase: "empty_round", decision: emptyGovernance });
          store.append(taskId, "task_abandoned", { reason: emptyGovernance.reason, action });
          return finish("abandoned");
        }
      }
      const resultSecurityDecision = security.assessToolResult(result);
      if (resultSecurityDecision) {
        store.append(taskId, "security_eval", { phase: "tool_result", action, decision: resultSecurityDecision });
      }

      const stepEval = evaluator.evaluateStep(task, decision, result, store.list(taskId));
      store.append(taskId, "loop_eval", { iteration, action, evaluation: stepEval });
      store.append(taskId, "quality_eval", {
        phase: "step",
        iteration,
        action,
        verifier: deterministicVerifierMetadata(task),
        evaluation: stepEval,
        criteria: task.quality
      });
      if (stepEval.gate === "stop") {
        const stepGovernance = governance.assessStep(task, result, stepEval, store.list(taskId));
        store.append(taskId, "governance_decision", { phase: "step", decision: stepGovernance });
        store.append(taskId, "task_failed", { reason: stepGovernance.reason, action });
        return finish("failed");
      }

      const stepGovernance = governance.assessStep(task, result, stepEval, store.list(taskId));
      if (stepGovernance.action !== "continue") {
        store.append(taskId, "governance_decision", { phase: "step", decision: stepGovernance });
      }
      if (stepGovernance.action === "abandon") {
        store.append(taskId, "task_abandoned", { reason: stepGovernance.reason, action });
        return finish("abandoned");
      }
      if (stepGovernance.action === "stop") {
        store.append(taskId, "task_failed", { reason: stepGovernance.reason, action });
        return finish("failed");
      }
    }

    const budgetGovernance = governance.assessBudgetExceeded(task, store.list(taskId));
    store.append(taskId, "governance_decision", { phase: "budget", decision: budgetGovernance });
    store.append(taskId, "budget_exceeded", { maxIterations: task.budget.maxIterations });
    return finish("budget_exceeded");
  } finally {
    if (shouldCloseStore) {
      store.close();
    }
  }

  function finish(status: TaskResult["status"], finalAnswer?: string): TaskResult {
    return {
      taskId,
      status,
      finalAnswer,
      events: store.list(taskId),
      traceDbPath
    };
  }
}

function summarizeEvents(events: TaskEvent[]): string {
  return events
    .slice(-10)
    .map((event) => `${event.type}: ${JSON.stringify(event.payload).slice(0, 500)}`)
    .join("\n");
}

type WorkspaceStatus = { ok: true } | { ok: false; reason: string };

function inspectWorkspace(workspace: string): WorkspaceStatus {
  if (!existsSync(workspace)) {
    return { ok: false, reason: `Workspace does not exist: ${workspace}` };
  }

  try {
    if (!statSync(workspace).isDirectory()) {
      return { ok: false, reason: `Workspace is not a directory: ${workspace}` };
    }
  } catch (error) {
    return { ok: false, reason: `Workspace could not be inspected: ${errorMessage(error)}` };
  }

  return { ok: true };
}

function chooseTraceDbPath(
  task: TaskInput,
  workspace: string,
  taskId: string,
  workspaceStatus: WorkspaceStatus
): string {
  const requestedTraceDbPath = resolve(task.traceDbPath ?? join(workspace, ".forloop", "state.sqlite"));
  if (workspaceStatus.ok || (task.traceDbPath && !isInside(workspace, requestedTraceDbPath))) {
    return requestedTraceDbPath;
  }

  return join(tmpdir(), "forloop", `${taskId}.sqlite`);
}

function isInside(base: string, target: string): boolean {
  const targetRelativeToBase = relative(base, target);
  return targetRelativeToBase === "" || (!targetRelativeToBase.startsWith("..") && !isAbsolute(targetRelativeToBase));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function approximateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4);
}

function deterministicVerifierMetadata(task: TaskInput): { kind: "deterministic"; checks: string[] } {
  const checks = ["tool_schema", "security_policy", "workspace_policy"];
  if (task.quality.requireTestsPassed) {
    checks.push("configured_tests");
  }
  if (task.quality.requireTypecheckPassed) {
    checks.push("configured_typecheck");
  }
  return { kind: "deterministic", checks };
}
