# ForLoop MCP

ForLoop MCP is a model-agnostic agent loop runtime for developers who want to write loops instead of hand-prompting models.

It separates the system into three explicit layers:

```text
Skill.md = reusable task knowledge
MCP server = tools and external capabilities
Orchestrator = control flow, state, evaluation, retries, and approvals
```

The MVP is CLI-first. It can run a controlled loop over a local repository, ask a model adapter for structured JSON decisions, execute safe repo tools, require approval before file edits, persist every event to SQLite, evaluate test results, and export traces.

## Quick Start

Install the CLI from npm after the package is published:

```bash
npm install -g forloop-mcp
```

Run the MCP server from any MCP-capable AI harness with `npx`:

```json
{
  "mcpServers": {
    "forloop-repo": {
      "command": "npx",
      "args": [
        "-y",
        "forloop-mcp@latest",
        "--workspace",
        "/absolute/path/to/repo",
        "--test-command",
        "npm test"
      ]
    }
  }
}
```

On Windows, if your harness does not resolve `npx` directly, use:

```json
{
  "mcpServers": {
    "forloop-repo": {
      "command": "cmd",
      "args": [
        "/c",
        "npx",
        "-y",
        "forloop-mcp@latest",
        "--workspace",
        "C:\\absolute\\path\\to\\repo",
        "--test-command",
        "npm test"
      ]
    }
  }
}
```

Direct MCP file edits are disabled by default. For trusted harnesses that already show tool approvals, add `--allow-mutations`:

```json
{
  "mcpServers": {
    "forloop-repo": {
      "command": "npx",
      "args": [
        "-y",
        "forloop-mcp@latest",
        "--workspace",
        "/absolute/path/to/repo",
        "--test-command",
        "npm test",
        "--allow-mutations"
      ]
    }
  }
}
```

Before the npm package is published, the GitHub install form works too:

```bash
npx -y github:Master0fFate/forloop-mcp --workspace /absolute/path/to/repo --test-command "npm test"
```

For MCP harness JSON before npm publication:

```json
{
  "mcpServers": {
    "forloop-repo": {
      "command": "npx",
      "args": [
        "-y",
        "github:Master0fFate/forloop-mcp",
        "--workspace",
        "/absolute/path/to/repo",
        "--test-command",
        "npm test"
      ]
    }
  }
}
```

```bash
npm install
npm run build
npm run smoke
```

Run the demo loop directly:

```bash
npm run dev -- run --workspace examples/buggy-auth-service --goal "Fix failing tests" --auto-approve
```

Start the MCP repo tool server over stdio:

```bash
npm run mcp -- --workspace examples/buggy-auth-service --test-command "npm test"
```

Direct MCP mutations are disabled by default. Enable them only for trusted clients:

```bash
npm run mcp -- --workspace examples/buggy-auth-service --test-command "npm test" --allow-mutations
```

## CLI

```bash
npx -y forloop-mcp@latest --workspace /absolute/path/to/repo --test-command "npm test"
forloop init --workspace ./my-repo
forloop run --workspace ./my-repo --goal "Fix failing tests" --test-command "npm test"
forloop inspect --trace-db ./my-repo/.forloop/state.sqlite
forloop export-trace --trace-db ./my-repo/.forloop/state.sqlite --out trace.json
forloop mcp-repo --workspace ./my-repo --test-command "npm test"
```

## Safety Defaults

- The model proposes structured actions; the runtime validates and executes.
- `repo.apply_patch` requires approval.
- Direct MCP `repo.apply_patch` calls are denied unless the server is started with `--allow-mutations`.
- `repo.run_tests` can only run the configured test command.
- File paths are sandboxed to the selected workspace.
- Every model response, tool call, tool result, approval, and evaluator result is persisted.

## Current Scope

Implemented now:

- TypeScript CLI
- Repo debugging skill
- Mock model adapter
- OpenAI adapter boundary stub
- SQLite trace store
- Repo tool registry
- MCP stdio server exposing repo tools
- Deterministic final evaluator
- Demo fixture
- Unit, integration, and smoke tests

Not included in this MVP:

- Web UI
- Arbitrary shell tools
- Long-term memory
- Cloud deployment
- Live provider calls

See [docs/architecture.md](docs/architecture.md) and [docs/getting-started.md](docs/getting-started.md).
