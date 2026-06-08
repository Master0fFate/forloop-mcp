# ForLoop MCP

> “I don't prompt Claude anymore. I have loops running that prompt Claude and figuring out what to do. My job is to write loops. And this is transition we're going to see for the rest of the year.”
>
> Boris Cherny

ForLoop MCP is an implementation of that shift: a local MCP server and loop runtime that lets an AI harness move from one-shot prompting to controlled execution.

Point your harness at a repository, give it a test command, optionally add a typecheck command, and ForLoop exposes repo tools, traceable state, approval gates, loop evals, quality evals, and a deterministic runtime that can drive a task until verifier checks pass or the budget runs out.

It separates the system into three explicit layers:

```text
Skill.md = reusable task knowledge
MCP server = tools and external capabilities
Orchestrator = control flow, state, evaluation, retries, and approvals
```

This release ships a stdio MCP repo server plus a CLI orchestrator. The MCP server plugs into AI harnesses. The CLI runs the full model-agnostic loop with skills, model adapters, approvals, per-step evals, quality gates, final evals, traces, and a demo repo.

## Quick Start

Install from npm:

```bash
npm install -g forloop-mcp
```

Run the MCP server with `npx`. This is the standard local stdio pattern: the harness launches a command, passes `args`, and talks to the server over stdin/stdout.

There is no single config file shape for every harness. Use the snippet that matches your client.

Claude Desktop, Claude Code project `.mcp.json`, Cursor, Windsurf, Devin Desktop, and other `mcpServers` clients:

```json
{
  "mcpServers": {
    "forloopRepo": {
      "type": "stdio",
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

Claude Code CLI:

```bash
claude mcp add --transport stdio forloopRepo -- npx -y forloop-mcp@latest --workspace /absolute/path/to/repo --test-command "npm test"
```

VS Code `.vscode/mcp.json`:

```json
{
  "servers": {
    "forloopRepo": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "forloop-mcp@latest",
        "--workspace",
        "${workspaceFolder}",
        "--test-command",
        "npm test"
      ]
    }
  }
}
```

Codex CLI:

```bash
codex mcp add forloopRepo -- npx -y forloop-mcp@latest --workspace /absolute/path/to/repo --test-command "npm test"
```

Codex TOML:

```toml
[mcp_servers.forloopRepo]
command = "npx"
args = ["-y", "forloop-mcp@latest", "--workspace", "/absolute/path/to/repo", "--test-command", "npm test"]
```

Windows fallback, for harnesses that do not resolve `npx` directly:

```json
{
  "mcpServers": {
    "forloopRepo": {
      "type": "stdio",
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

Direct MCP file edits are disabled by default. For trusted harnesses that already show tool approvals, add `--allow-mutations` to the `args` array.

For a second deterministic verifier, add a configured typecheck command:

```json
"args": ["-y", "forloop-mcp@latest", "--workspace", "/absolute/path/to/repo", "--test-command", "npm test", "--typecheck-command", "npm run typecheck"]
```

This package is built for local stdio MCP hosts. Remote ChatGPT/OpenAI connector surfaces require remote HTTP MCP servers, so use an HTTP bridge or deploy a remote wrapper if you need that environment.

If npm is unavailable or you want the latest `main` branch, use GitHub as the package source:

```json
{
  "mcpServers": {
    "forloopRepo": {
      "type": "stdio",
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

Why this works: `forloop-mcp` publishes a binary named `forloop-mcp`. Modern `npx` runs the binary that matches the package name and passes every argument after the package spec to that binary.

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
forloop run --workspace ./my-repo --goal "Fix failing tests" --test-command "npm test" --typecheck-command "npm run typecheck"
forloop inspect --trace-db ./my-repo/.forloop/state.sqlite
forloop export-trace --trace-db ./my-repo/.forloop/state.sqlite --out trace.json
forloop mcp-repo --workspace ./my-repo --test-command "npm test" --typecheck-command "npm run typecheck"
```

## Safety Defaults

- The model proposes structured actions; the runtime validates and executes.
- `repo.apply_patch` requires approval.
- Direct MCP `repo.apply_patch` calls are denied unless the server is started with `--allow-mutations`.
- `repo.run_tests` can only run the configured test command.
- `repo.run_typecheck` can only run the configured typecheck command, when one is configured.
- File paths are sandboxed to the selected workspace.
- Every tool result is scored by a loop eval gate before the next iteration.
- Final answers are rejected by default unless the loop gathered tool evidence and recorded a passing configured test run.
- If `quality.requireTypecheckPassed` is enabled, final answers also require a passing configured typecheck run.
- Every model response, tool call, tool result, approval, and evaluator result is persisted.
- Missing workspaces, missing skills, model failures, repeated actions, invalid model output, denied approvals, and budget exhaustion resolve to explicit task states instead of silent crashes.

## Quality Loop

Execution loops answer “what action should run next?” Quality loops answer “is this good enough to ship?”

ForLoop makes that second loop explicit through the task `quality` block:

```yaml
quality:
  minStepScore: 0.2
  minFinalConfidence: 0
  requireEvidenceBeforeFinal: true
  requireTestsPassed: true
  requireTypecheckPassed: false
```

Each tool result emits `quality_eval` feedback for the next iteration. Final answers that do not clear the quality gate are rejected and fed back into the loop instead of being shipped as weak completion claims.

By default, the verifier is deterministic: registered tool schemas, workspace policy, configured tests, and optional configured typecheck. `minFinalConfidence` exists only as an extra policy knob; it is not treated as proof because it comes from the agent that produced the answer. Model-based quality review should use a separate verifier model or subagent with a different system prompt.

## Current Scope

Implemented now:

- TypeScript CLI
- Repo debugging skill
- Mock model adapter
- OpenAI adapter boundary stub
- SQLite trace store
- Repo tool registry
- MCP stdio server exposing repo tools
- Deterministic loop, quality, and final evaluator
- Demo fixture
- Unit, integration, and smoke tests

Not included in this MVP:

- Web UI
- Arbitrary shell tools
- Long-term memory
- Cloud deployment
- Live provider calls

See [docs/architecture.md](docs/architecture.md) and [docs/getting-started.md](docs/getting-started.md).
