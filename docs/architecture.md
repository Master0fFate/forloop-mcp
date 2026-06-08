# Architecture

ForLoop MCP implements the architecture from `model_agnostic_agent_loop_conceptualization.md` as a compact MVP.

## Runtime Flow

```text
User goal
  -> skill loader
  -> model adapter
  -> structured decision parser
  -> approval policy
  -> repo tool registry / MCP server
  -> deterministic loop eval / quality eval / final eval
  -> SQLite event trace
```

The orchestrator owns budgets, validation, approvals, quality gates, stop conditions, and state. The model only proposes a JSON decision.

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

## Edge-Case Resilience

The runtime treats common failure modes as explicit task states. Missing or invalid workspaces fail without creating the requested workspace. Missing skills and model exceptions are persisted as task events. Invalid model output, repeated actions, denied approvals, failed eval gates, and budget exhaustion all stop through named events so the next run can inspect what broke.
