# Architecture

ForLoop MCP implements the architecture from `model_agnostic_agent_loop_conceptualization.md` as a compact MVP.

## Runtime Flow

```text
User goal
  -> skill loader
  -> model adapter
  -> structured decision parser
  -> approval policy
  -> deterministic security gate
  -> repo tool registry / MCP server
  -> explicit evaluation criteria
  -> deterministic loop eval / quality eval / final eval
  -> deterministic governance decision
  -> SQLite event trace
```

The orchestrator owns budgets, validation, approvals, security gates, evaluation criteria, quality gates, governance decisions, stop conditions, and state. The model only proposes a JSON decision.

## Boundaries

- `src/orchestrator`: loop, decision parsing, approvals, evaluator, schemas.
- `src/models`: provider-neutral adapter interface plus mock and provider stubs.
- `src/tools`: local repo capabilities with workspace sandboxing.
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

Task state is append-only. Each event is stored in SQLite as JSON payload with a task id, timestamp, and event type. This makes runs inspectable and exportable.

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
  requireApprovalForMutations: true
```

The orchestrator emits `security_eval` before tool execution. Unknown tools and tools outside `allowedTools` are denied before execution. Workspace escapes and unconfigured command attempts are also surfaced as security evaluations from tool results. Standalone MCP servers can enforce the same allowed-tool policy with repeated `--allowed-tool <name>` flags.

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

## Edge-Case Resilience

The runtime treats common failure modes as explicit task states. Missing or invalid workspaces fail without creating the requested workspace. Missing skills and model exceptions are persisted as task events. Invalid model output, repeated actions, denied approvals, failed eval gates, and budget exhaustion all stop through named events so the next run can inspect what broke.
