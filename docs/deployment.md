# Deployment

ForLoop MCP is local-first. The primary installation path is still `npx -y forloop-mcp@latest --workspace ...` as a stdio MCP server launched by the user's harness.

The container scaffold is optional for teams that want the web console or a wrapper service on their own infrastructure.

## Local Web Console

```bash
npm install
npm run build
node dist/src/cli/main.js web --workspace . --port 4317
```

Open `http://127.0.0.1:4317`.

## Docker

```bash
docker build -t forloop-mcp .
docker run --rm -p 4317:4317 -v "$PWD:/workspace" --env-file .env forloop-mcp
```

On PowerShell:

```powershell
docker run --rm -p 4317:4317 -v "${PWD}:/workspace" --env-file .env forloop-mcp
```

## Compose

```bash
docker compose up --build
```

`compose.yaml` mounts the current repository as `/workspace` and starts `forloop web`. It does not replace stdio MCP usage.

## Provider Config

ForLoop reads `.forloop/config.yaml` by default when a command accepts `--config`. The web console also has presets for OpenAI, Anthropic, OpenRouter, Ollama, vLLM, LM Studio, and custom OpenAI-compatible providers.

```yaml
provider:
  kind: openai-compatible
  baseUrl: https://openrouter.ai/api/v1
  modelId: local-model-id
  apiKeyEnv: OPENROUTER_API_KEY
  structuredOutput: json_schema

shell:
  enabled: false
  allowArbitrary: false
  allowShellMode: false
  allowedCommands: []
```

Use `apiKeyEnv` for durable configuration. The web console accepts API keys for the current local server process and clears the key field after successful validation; do not commit raw keys.

Anthropic uses the native Messages API shape:

```yaml
provider:
  kind: anthropic
  baseUrl: https://api.anthropic.com
  modelId: anthropic-model-id
  apiKeyEnv: ANTHROPIC_API_KEY
  structuredOutput: tool_use
```
