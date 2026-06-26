export function renderIndexHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>ForLoop MCP Console</title>
    <link rel="stylesheet" href="/assets/app.css">
  </head>
  <body>
    <main class="app-shell">
      <aside class="rail" aria-label="ForLoop sections">
        <div class="brand"><span>ForLoop</span></div>
        <nav class="nav-list">
          <a href="#overview">Overview</a>
          <a href="#provider">Provider</a>
          <a href="#memory">Memory</a>
          <a href="#shell">Shell</a>
          <a href="#deploy">Deploy</a>
        </nav>
      </aside>
      <section class="workspace">
        <header class="topbar" id="overview">
          <div>
            <p class="eyebrow">Local MCP runtime</p>
            <h1>ForLoop Console</h1>
          </div>
          <div class="status-strip" id="status-strip"><span>Loading</span></div>
        </header>

        <section class="metric-grid" aria-label="Runtime status">
          <div class="metric">
            <span class="label">Session</span>
            <strong id="session-id">-</strong>
          </div>
          <div class="metric">
            <span class="label">Namespace</span>
            <strong id="session-storage">-</strong>
          </div>
          <div class="metric">
            <span class="label">Shell</span>
            <strong id="shell-state">Locked</strong>
          </div>
          <div class="metric">
            <span class="label">Provider</span>
            <strong id="provider-state">Unset</strong>
          </div>
        </section>

        <section class="grid two">
          <article class="panel" id="provider">
            <div class="panel-head">
              <div>
                <p class="eyebrow">Live calls</p>
                <h2>Provider</h2>
              </div>
              <span class="pill" id="provider-pill">config</span>
            </div>
            <form id="provider-form" class="form-grid">
              <label>
                <span>Provider</span>
                <select name="providerPreset" id="provider-preset">
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="openrouter">OpenRouter</option>
                  <option value="ollama">Ollama</option>
                  <option value="vllm">vLLM</option>
                  <option value="lmstudio">LM Studio</option>
                  <option value="custom-openai-compatible">Custom compatible</option>
                </select>
              </label>
              <input type="hidden" name="kind" value="openai-compatible">
              <input type="hidden" name="structuredOutput" value="json_schema">
              <label>
                <span>Base URL</span>
                <input name="baseUrl" value="https://api.openai.com/v1" autocomplete="off">
              </label>
              <label>
                <span>Model ID</span>
                <input name="modelId" placeholder="Paste provider model ID" autocomplete="off">
              </label>
              <label>
                <span>API key</span>
                <input name="apiKey" type="password" placeholder="Use for this local session" autocomplete="off">
              </label>
              <label>
                <span>API key env</span>
                <input name="apiKeyEnv" value="OPENAI_API_KEY" autocomplete="off">
              </label>
              <button type="submit">Validate</button>
            </form>
            <pre class="output" id="provider-output"></pre>
          </article>

          <article class="panel" id="memory">
            <div class="panel-head">
              <div>
                <p class="eyebrow">Session scoped</p>
                <h2>Memory</h2>
              </div>
              <span class="pill" id="memory-pill">0 records</span>
            </div>
            <form id="memory-form" class="form-grid">
              <label class="span-2">
                <span>Content</span>
                <textarea name="content" rows="4"></textarea>
              </label>
              <label>
                <span>Tags</span>
                <input name="tags" placeholder="session, provider" autocomplete="off">
              </label>
              <button type="submit">Remember</button>
            </form>
            <div class="memory-list" id="memory-list"></div>
          </article>
        </section>

        <section class="grid two">
          <article class="panel" id="shell">
            <div class="panel-head">
              <div>
                <p class="eyebrow">Governed execution</p>
                <h2>Shell</h2>
              </div>
              <span class="pill" id="shell-pill">locked</span>
            </div>
            <form id="shell-form" class="form-grid">
              <label>
                <span>Command</span>
                <input name="command" autocomplete="off">
              </label>
              <label>
                <span>Args</span>
                <input name="args" autocomplete="off">
              </label>
              <button type="submit">Run</button>
            </form>
            <pre class="output" id="shell-output"></pre>
          </article>

          <article class="panel" id="deploy">
            <div class="panel-head">
              <div>
                <p class="eyebrow">Optional scaffold</p>
                <h2>Deployment</h2>
              </div>
              <span class="pill">local first</span>
            </div>
            <div class="deploy-list">
              <div><span>Primary</span><strong>stdio MCP</strong></div>
              <div><span>Web console</span><strong>localhost</strong></div>
              <div><span>Container</span><strong>optional</strong></div>
              <div><span>Secrets</span><strong>env or config</strong></div>
            </div>
          </article>
        </section>
      </section>
    </main>
    <script src="/assets/app.js" type="module"></script>
  </body>
</html>`;
}
