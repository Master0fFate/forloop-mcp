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
  -> deterministic loop eval / final eval
  -> SQLite event trace
```

The orchestrator owns budgets, validation, approvals, eval gates, stop conditions, and state. The model only proposes a JSON decision.

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

Every executed tool result receives a `loop_eval` event before the next model iteration. The eval layer turns tool output into structured feedback, scores step quality, and can stop the task when a proposed action violates a hard policy boundary such as escaping the workspace or running a command other than the configured test command.

Final answers pass through a separate final evaluator. The final gate rejects empty answers and rejects completion when the latest configured test run failed.
