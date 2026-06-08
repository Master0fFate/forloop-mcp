import type { ModelAdapter, ModelRequest, ModelResponse } from "./base.js";

export class OpenAIAdapter implements ModelAdapter {
  provider = "openai";
  model: string;

  constructor(model = "gpt-5-mini") {
    this.model = model;
  }

  async generate(_request: ModelRequest): Promise<ModelResponse> {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is required to use the OpenAI adapter.");
    }

    throw new Error(
      "OpenAIAdapter is a provider boundary stub in this MVP. Wire the current OpenAI Responses API here without changing the orchestrator."
    );
  }

  supportsTools(): boolean {
    return true;
  }

  supportsJsonMode(): boolean {
    return true;
  }
}
