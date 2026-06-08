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
  -> deterministic evaluator
  -> SQLite event trace
```

The orchestrator owns budgets, validation, approvals, stop conditions, and state. The model only proposes a JSON decision.

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
