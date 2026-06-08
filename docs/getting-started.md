# Getting Started

## MCP Harness Install

Use this command in Claude Desktop, Cursor, Windsurf, VS Code MCP configs, Codex MCP configs, or any harness that accepts a standard MCP `command` plus `args` block:

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

For Windows harnesses that do not resolve `npx` directly:

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

Add `--allow-mutations` only for trusted harnesses where you want direct MCP patching enabled.

Before the npm package is published, install from GitHub:

```bash
npx -y github:Master0fFate/forloop-mcp --workspace /absolute/path/to/repo --test-command "npm test"
```

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

Start the MCP repo server:

```bash
npm run mcp -- --workspace examples/buggy-auth-service --test-command "npm test"
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

Use an explicit test command:

```bash
npm run dev -- run --workspace C:\path\to\repo --goal "Fix failing tests" --test-command "npm test"
```

The runtime will not execute arbitrary shell commands. `repo.run_tests` is restricted to the configured command.
