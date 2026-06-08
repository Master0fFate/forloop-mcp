# Security

ForLoop MCP is safe by default for local development workflows.

## Controls

- Model outputs are schema-validated before execution.
- Tool names must be registered.
- Paths are resolved and checked against the workspace root.
- Mutating tools require approval.
- Direct MCP mutations are disabled by default and require `--allow-mutations`.
- Test execution is limited to the configured command.
- Every action is written to the trace database.

## Approval Modes

- `manual`: prompt before mutations.
- `auto`: approve mutations for trusted smoke tests or local demos.
- `deny`: deny mutations, useful for testing safety gates.

## Non-Goals

The MVP does not expose arbitrary shell access, deployment, secrets reading, database writes, or cloud credentials.
