# Getting Started

## MCP Harness Install

ForLoop MCP runs as a local stdio MCP server. Your AI harness starts it with a command and args, then exchanges MCP messages over stdin/stdout.

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

Add `--allow-mutations` only for trusted harnesses where you want direct MCP patching enabled.

Add `--typecheck-command "npm run typecheck"` when you want the MCP server to expose a second deterministic verifier through `repo.run_typecheck`. The tool can only run that configured command.

Add repeated `--allowed-tool <name>` flags when a wider loop should see only a smaller sanctioned action surface.

This package is built for local stdio MCP hosts. Remote ChatGPT/OpenAI connector surfaces require remote HTTP MCP servers, so use an HTTP bridge or deploy a remote wrapper if you need that environment.

If npm is unavailable or you want the latest `main` branch, install from GitHub:

```bash
npx -y github:Master0fFate/forloop-mcp --workspace /absolute/path/to/repo --test-command "npm test"
```

GitHub MCP harness config:

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

`forloop-mcp` publishes a binary with the same name as the package. Modern `npx` resolves that binary and passes the remaining args to it.

Install dependencies:

```bash
npm install
```

Run the automated smoke test:

```bash
npm run smoke
```

Run the demo manually:

```bash
npm run dev -- run --workspace examples/buggy-auth-service --goal "Fix failing tests" --auto-approve
```

For task files, make acceptance criteria explicit:

```yaml
evaluationCriteria:
  - id: tests_passed
    kind: tests_passed
    description: The latest configured test run passed.
    required: true
```

Start the MCP repo server:

```bash
npm run mcp -- --workspace examples/buggy-auth-service --test-command "npm test"
```

Start the MCP repo server with an optional typecheck verifier:

```bash
npm run mcp -- --workspace examples/buggy-auth-service --test-command "npm test" --typecheck-command "npm test"
```

Start the MCP repo server with a narrowed security boundary:

```bash
npm run mcp -- --workspace examples/buggy-auth-service --test-command "npm test" --allowed-tool repo.list_files --allowed-tool repo.read_file --allowed-tool repo.run_tests
```

Direct MCP file edits are denied by default. Enable them only for trusted clients:

```bash
npm run mcp -- --workspace examples/buggy-auth-service --test-command "npm test" --allow-mutations
```

Inspect the trace:

```bash
npm run dev -- inspect --trace-db examples/buggy-auth-service/.forloop/state.sqlite
```

Export the latest trace:

```bash
npm run dev -- export-trace --trace-db examples/buggy-auth-service/.forloop/state.sqlite --out trace.json
```

## Real Repositories

Use explicit verifier commands:

```bash
npm run dev -- run --workspace C:\path\to\repo --goal "Fix failing tests" --test-command "npm test" --typecheck-command "npm run typecheck"
```

The runtime will not execute arbitrary shell commands. `repo.run_tests` and `repo.run_typecheck` are restricted to their configured commands.
