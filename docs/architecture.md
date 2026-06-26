# Architecture

ForLoop MCP implements a local-first agent loop runtime with stdio MCP tools, deterministic gates, optional live providers, session-isolated memory, governed shell execution, and a local web console.

## Runtime Flow

```text
User goal
  -> skill loader
  -> model adapter
  -> structured decision parser
  -> approval policy
  -> deterministic security gate
  -> repo, memory, and shell tool registry / MCP server
  -> explicit evaluation criteria
  -> deterministic loop eval / quality eval / final eval
  -> deterministic governance decision
  -> SQLite event trace
```

The orchestrator owns budgets, validation, approvals, security gates, evaluation criteria, quality gates, governance decisions, stop conditions, and state. The model only proposes a JSON decision.

## Boundaries

- `src/orchestrator`: loop, decision parsing, approvals, evaluator, schemas.
- `src/models`: provider-neutral adapter interface plus mock, OpenAI-compatible, and Anthropic adapters.
- `src/tools`: local repo and shell capabilities with workspace sandboxing.
- `src/memory`: session-isolated long-term memory store.
- `src/config`: local config file schemas for providers, shell policy, and web settings.
- `src/web`: local web console and JSON API.
- `src/mcp`: stdio MCP server exposing the repo tools.
- `src/storage`: SQLite event store.
- `skills`: markdown procedures injected into model context.

## Decision Schema

Every model output must be a valid JSON decision:

```json
{
  "status": "continue",
  "summary": "Need to inspect the failing file.",
  "next_action": {
    "type": "tool_call",
    "tool": "repo.read_file",
    "args": { "path": "src/example.js" }
  },
  "confidence": 0.8,
  "risk": "low",
  "requires_human_approval": false
}
```

## Persistence

Task state is append-only. Each event is stored in SQLite as JSON payload with a task id, timestamp, and event type. Trace databases are isolated per session under a `sessions/<session-storage-name>/` directory. The default location is `.forloop/sessions/<session-storage-name>/state.sqlite`; explicit `traceDbPath` values choose the base directory and file name, then ForLoop still inserts the per-session directory. Long-term memory uses the same namespace at `.forloop/sessions/<session-storage-name>/memory.sqlite`, so separate Codex sessions cannot share trace or memory data unless they intentionally use the same stable session id.

## Live Providers

Provider configuration is explicit. OpenAI-compatible and Anthropic adapters require caller-supplied `modelId` values and either an inline API key for a transient UI session or `apiKeyEnv` for durable config. OpenAI-compatible endpoints can point at services such as OpenRouter, Ollama, vLLM, and LM Studio by changing `baseUrl`.

Structured output support differs by backend, so ForLoop treats provider-side JSON schema or tool-use controls as a first pass only. Every response is normalized and validated again with the internal `AgentDecision` schema before the orchestrator can execute it.

## Eval Layer

Every executed tool result receives `loop_eval` and `quality_eval` events before the next model iteration. The eval layer turns tool output into structured feedback, scores step quality, and can stop the task when a proposed action violates a hard policy boundary such as escaping the workspace or running a command other than the configured test or typecheck command.

Final answers pass through a separate quality gate. By default, final completion requires a non-empty answer, prior tool evidence, and a passing configured test run. If `quality.requireTypecheckPassed` is enabled, the final gate also requires a passing configured typecheck run.

## Quality Loop

An execution loop keeps asking what to do next. The quality loop decides whether the work is good enough to continue, reject, or ship.

The task `quality` block defines the standard:

```yaml
quality:
  minStepScore: 0.2
  minFinalConfidence: 0
  requireEvidenceBeforeFinal: true
  requireTestsPassed: true
  requireTypecheckPassed: false
```

Rejected final answers produce `final_rejected` plus `quality_eval` events. Those events become part of the next model request, so quality feedback is fed back into the loop instead of living only in logs.

The default verifier is deterministic: schemas, workspace policy, configured tests, and optional configured typecheck. Self-reported confidence is not proof; `minFinalConfidence` is only an optional policy threshold. If quality review is model-based, it must come from a separate verifier model or a subagent with a different system prompt, otherwise it is the same agent rubber-stamping itself.

## Evaluation Criteria

The final evaluator does not rely on one vague score. It evaluates explicit criteria and writes the criteria report into the final eval.

```yaml
evaluationCriteria:
  - id: tool_evidence
    kind: tool_evidence
    description: The loop gathered tool evidence before final completion.
    required: true
  - id: tests_passed
    kind: tests_passed
    description: The latest configured test run passed.
    required: true
```

Supported deterministic criterion kinds are `tool_evidence`, `tests_passed`, `typecheck_passed`, and `diff_present`. When `evaluationCriteria` is empty, ForLoop derives default criteria from the `quality` policy. When criteria are supplied, they become the final acceptance standard. Required failures reject the final answer and feed criterion feedback into the next model turn.

## Security Gate

In closed loops, the gate is mostly a quality check. In open loops, the same boundary also becomes a security control: it decides whether an exploratory action is sanctioned before anything runs.

The task `security` block defines the action surface:

```yaml
security:
  allowedTools:
    - repo.list_files
    - repo.search_code
    - repo.read_file
    - repo.apply_patch
    - repo.run_tests
    - repo.run_typecheck
    - repo.git_diff
    - memory.remember
    - memory.search
    - memory.list
    - memory.delete
    - shell.status
    - shell.run
  requireApprovalForMutations: true
```

The orchestrator emits `security_eval` before tool execution. Unknown tools and tools outside `allowedTools` are denied before execution. Workspace escapes, disabled shell execution, shell allow-list failures, and unconfigured command attempts are also surfaced as security evaluations from tool results. Standalone MCP servers can enforce the same allowed-tool policy with repeated `--allowed-tool <name>` flags.

## Governance Layer

An execution loop decides how the work continues. Governance decides whether it should continue.

The task `governance` block defines the operating policy:

```yaml
governance:
  escalateHighRisk: true
  recoverOnFailedStep: true
  maxRecoveryAttempts: 3
  maxFinalRejections: 2
  maxConsecutiveFailedSteps: 3
```

The deterministic governance layer emits `governance_decision` events with `continue`, `recover`, `escalate`, `stop`, or `abandon`. High-risk decisions can be escalated before execution. Failed steps can enter recovery. Repeated rejected finals or exhausted recovery attempts can abandon the mission instead of letting the loop burn the rest of the budget.

## Exit Conditions

The stop condition is not the agent's own "looks done." Completion is anchored to external criteria and budget policy.

External exits include:

- Required evaluation criteria passed.
- Security policy denied the proposed action.
- Human approval denied an escalation.
- Repeated final answers failed quality gates.
- Empty rounds exceeded `budget.maxEmptyRounds`.
- Iterations exceeded `budget.maxIterations`.
- Approximate model output tokens exceeded `budget.maxApproxTokens`.

`budget_eval` events track approximate model-output token spend using a simple character-based estimate. It is deliberately conservative enough for governance, not a billing-grade tokenizer.

## Edge-Case Resilience

The runtime treats common failure modes as explicit task states. Missing or invalid workspaces fail without creating the requested workspace. Missing skills and model exceptions are persisted as task events. Invalid model output, repeated actions, denied approvals, failed eval gates, and budget exhaustion all stop through named events so the next run can inspect what broke.
