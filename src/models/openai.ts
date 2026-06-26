import type { ModelAdapter, ModelRequest, ModelResponse } from "./base.js";
import { OpenAICompatibleChatAdapter } from "./provider-config.js";

export class OpenAIAdapter implements ModelAdapter {
  provider = "openai";
  model: string;
  private readonly adapter: OpenAICompatibleChatAdapter;

  constructor(model = process.env.FORLOOP_OPENAI_MODEL) {
    if (!model) {
      throw new Error("FORLOOP_OPENAI_MODEL is required to use the OpenAI adapter.");
    }
    this.model = model;
    this.adapter = new OpenAICompatibleChatAdapter({
      kind: "openai-compatible",
      baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      modelId: model,
      apiKeyEnv: "OPENAI_API_KEY",
      headers: {},
      structuredOutput: "json_schema",
      timeoutMs: 60000
    });
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is required to use the OpenAI adapter.");
    }
    const response = await this.adapter.generate(request);
    return { ...response, provider: this.provider };
  }

  supportsTools(): boolean {
    return true;
  }

  supportsJsonMode(): boolean {
    return true;
  }
}
