import { randomUUID } from "node:crypto";
import { parseAgentDecision } from "./decision.js";
import { TaskInputSchema, type TaskInput, type TaskResult } from "./schemas.js";
import { approximateTokens, createTraceContext, deterministicVerifierMetadata, errorMessage, summarizeEvents } from "./loop-helpers.js";
import type { ModelResponse } from "../models/base.js";
import type { LoadedSkill } from "../skills/loader.js";
import { SQLiteStateStore } from "../storage/sqlite.js";
import { type RunAgentLoopOptions } from "./loop-options.js";
import { createLoopRuntime } from "./loop-runtime.js";

export type { RunAgentLoopOptions } from "./loop-options.js";

export async function runAgentLoop(input: unknown, options: RunAgentLoopOptions = {}): Promise<TaskResult> {
  const task = TaskInputSchema.parse(input);
  const taskId = randomUUID();
  const { workspace, session, workspaceStatus, traceDbPath } = createTraceContext(task, taskId);
  const store = options.stateStore ?? (await SQLiteStateStore.open(traceDbPath));
  const shouldCloseStore = !options.stateStore;
  let runtime:
    | Awaited<ReturnType<typeof createLoopRuntime>>
    | undefined;

  try {
    store.append(taskId, "task_created", { task: { ...task, workspace, sessionId: session.id }, sessionStorageName: session.storageName, traceDbPath });

    if (!workspaceStatus.ok) {
      store.append(taskId, "task_failed", { reason: workspaceStatus.reason });
      return finish("failed");
    }

    runtime = await createLoopRuntime(task, options, workspace, session);
    const { approvalManager, evaluator, governance, model, registry, security, skillLoader } = runtime;

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
    runtime?.close();
    if (shouldCloseStore) {
      store.close();
    }
  }

  function finish(status: TaskResult["status"], finalAnswer?: string): TaskResult {
    return { taskId, status, finalAnswer, events: store.list(taskId), sessionId: session.id, sessionStorageName: session.storageName, traceDbPath };
  }
}
