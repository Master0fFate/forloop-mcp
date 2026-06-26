export const appJs = `
const statusStrip = document.querySelector("#status-strip");
const sessionId = document.querySelector("#session-id");
const sessionStorage = document.querySelector("#session-storage");
const shellState = document.querySelector("#shell-state");
const providerState = document.querySelector("#provider-state");
const shellPill = document.querySelector("#shell-pill");
const providerPill = document.querySelector("#provider-pill");
const memoryPill = document.querySelector("#memory-pill");
const memoryList = document.querySelector("#memory-list");

const providerForm = document.querySelector("#provider-form");
const providerOutput = document.querySelector("#provider-output");
const memoryForm = document.querySelector("#memory-form");
const shellForm = document.querySelector("#shell-form");
const shellOutput = document.querySelector("#shell-output");
const providerPreset = document.querySelector("#provider-preset");

const providerPresets = {
  openai: {
    kind: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    structuredOutput: "json_schema",
    placeholder: "Paste OpenAI model ID"
  },
  anthropic: {
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    structuredOutput: "tool_use",
    placeholder: "Paste Anthropic model ID"
  },
  openrouter: {
    kind: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
    structuredOutput: "json_schema",
    placeholder: "author/model-slug"
  },
  ollama: {
    kind: "openai-compatible",
    baseUrl: "http://localhost:11434/v1",
    apiKeyEnv: "",
    structuredOutput: "json_schema",
    placeholder: "local Ollama model name"
  },
  vllm: {
    kind: "openai-compatible",
    baseUrl: "http://localhost:8000/v1",
    apiKeyEnv: "",
    structuredOutput: "json_schema",
    placeholder: "served model name"
  },
  lmstudio: {
    kind: "openai-compatible",
    baseUrl: "http://localhost:1234/v1",
    apiKeyEnv: "",
    structuredOutput: "json_schema",
    placeholder: "loaded local model ID"
  },
  "custom-openai-compatible": {
    kind: "openai-compatible",
    baseUrl: "",
    apiKeyEnv: "",
    structuredOutput: "json_schema",
    placeholder: "Paste provider or local model ID"
  }
};

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  return response.json();
}

function write(target, value) {
  target.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function applyProviderPreset(presetName) {
  const preset = providerPresets[presetName] || providerPresets["custom-openai-compatible"];
  providerForm.elements.kind.value = preset.kind;
  providerForm.elements.baseUrl.value = preset.baseUrl;
  providerForm.elements.apiKeyEnv.value = preset.apiKeyEnv;
  providerForm.elements.structuredOutput.value = preset.structuredOutput;
  providerForm.elements.modelId.placeholder = preset.placeholder;
}

async function refreshStatus() {
  const status = await jsonFetch("/api/status");
  write(statusStrip, status.workspace);
  write(sessionId, status.session.id);
  write(sessionStorage, status.session.storageName);
  write(shellState, status.shell.enabled ? "Enabled" : "Locked");
  write(shellPill, status.shell.enabled ? "enabled" : "locked");
  write(providerState, status.provider ? status.provider.kind : "Unset");
  write(providerPill, status.provider ? status.provider.kind : "config");
}

async function refreshMemory() {
  const data = await jsonFetch("/api/memory");
  write(memoryPill, data.records.length + " records");
  memoryList.replaceChildren(
    ...data.records.map((record) => {
      const item = document.createElement("div");
      item.className = "memory-item";
      const text = document.createElement("p");
      text.textContent = record.content;
      const tags = document.createElement("div");
      tags.className = "tag-row";
      for (const tag of record.tags) {
        const pill = document.createElement("span");
        pill.className = "tag";
        pill.textContent = tag;
        tags.append(pill);
      }
      item.append(text, tags);
      return item;
    })
  );
}

providerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(providerForm);
  const body = Object.fromEntries(form.entries());
  if (!body.apiKey) delete body.apiKey;
  if (!body.apiKeyEnv) delete body.apiKeyEnv;
  delete body.providerPreset;
  const result = await jsonFetch("/api/provider/config", { method: "POST", body: JSON.stringify(body) });
  write(providerOutput, result);
  if (result.ok && providerForm.elements.apiKey) {
    providerForm.elements.apiKey.value = "";
  }
  await refreshStatus();
});

providerPreset.addEventListener("change", () => applyProviderPreset(providerPreset.value));

document.querySelectorAll('.nav-list a[href^="#"]').forEach((link) => {
  link.addEventListener("click", (event) => {
    const id = link.getAttribute("href");
    const target = id ? document.querySelector(id) : null;
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ block: "start", behavior: "smooth" });
    history.replaceState(null, "", id);
  });
});

memoryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(memoryForm);
  const tags = String(form.get("tags") || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  await jsonFetch("/api/memory", {
    method: "POST",
    body: JSON.stringify({ content: form.get("content"), tags })
  });
  memoryForm.reset();
  await refreshMemory();
});

shellForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(shellForm);
  const args = String(form.get("args") || "")
    .split(" ")
    .map((arg) => arg.trim())
    .filter(Boolean);
  const result = await jsonFetch("/api/shell/run", {
    method: "POST",
    body: JSON.stringify({ command: form.get("command"), args })
  });
  write(shellOutput, result);
});

applyProviderPreset(providerPreset.value);
await refreshStatus();
await refreshMemory();
`;
