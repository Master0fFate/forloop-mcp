# Security

ForLoop MCP is safe by default for local development workflows.

## Controls

- Model outputs are schema-validated before execution.
- Tool names must be registered.
- The orchestrator denies tools outside `security.allowedTools` before execution.
- The standalone MCP server can deny tools outside repeated `--allowed-tool` flags.
- Paths are resolved and checked against the workspace root.
- Mutating tools require approval.
- Direct MCP mutations are disabled by default and require `--allow-mutations`.
- Long-term memory is stored per session under `.forloop/sessions/<session-storage-name>/memory.sqlite`.
- `shell.run` is exposed for MCP/CLI/UI workflows but disabled until shell policy explicitly enables it.
- Shell execution is rooted to the workspace and can require an executable allow-list.
- Test execution is limited to the configured command.
- Typecheck execution is limited to the configured command, when one is configured.
- High-risk decisions are escalated before execution by default.
- Governance can abandon repeated failures instead of continuing unbounded recovery.
- Every action, evaluator result, and governance decision is written to the trace database.
- Default trace storage is per-session under `.forloop/sessions/<session-storage-name>/state.sqlite`.
- Provider responses are validated against ForLoop's internal decision schema before execution.

## Approval Modes

- `manual`: prompt before mutations.
- `auto`: approve mutations for trusted smoke tests or local demos.
- `deny`: deny mutations, useful for testing safety gates.

## Secrets

Prefer `apiKeyEnv` and environment variables for durable provider credentials. The web console can accept API keys for the current local server process, but raw keys should not be committed to `.forloop/config.yaml`.

## Shell Tools

Shell tools are opt-in:

```bash
forloop shell --workspace . --allow-shell --shell-command node --command node --arg -e --arg "console.log(process.cwd())"
```

Use `--allow-arbitrary-shell` only for trusted local sessions. Use `--allow-shell-mode` only when a command genuinely needs shell parsing.

## Deployment

The Docker and Compose files are optional scaffolds. They start the local web console and do not change the default stdio MCP security model.
