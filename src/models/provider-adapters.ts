import type { ModelAdapter, ModelRequest, ModelResponse } from "./base.js";
import { MockModelAdapter } from "./mock.js";
import { authorizationHeaders, joinUrl, postJson } from "./provider-http.js";
import {
  anthropicBody,
  extractAnthropicPayload,
  extractOpenAICompatiblePayload,
  normalizeDecision,
  openAICompatibleBody
} from "./provider-payloads.js";
import {
  ProviderConfigSchema,
  type AnthropicProviderConfig,
  type OpenAICompatibleProviderConfig,
  type ProviderConfig
} from "./provider-schemas.js";

export function createModelAdapterFromConfig(config: ProviderConfig): ModelAdapter {
  const parsed = ProviderConfigSchema.parse(config);
  switch (parsed.kind) {
    case "mock":
      return new MockModelAdapter();
    case "openai-compatible":
      return new OpenAICompatibleChatAdapter(parsed);
    case "anthropic":
      return new AnthropicMessagesAdapter(parsed);
  }
}

export class OpenAICompatibleChatAdapter implements ModelAdapter {
  provider = "openai-compatible";
  model: string;

  constructor(private readonly config: OpenAICompatibleProviderConfig) {
    this.model = config.modelId;
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const response = await postJson(
      joinUrl(this.config.baseUrl, "chat/completions"),
      openAICompatibleBody(this.config, request),
      authorizationHeaders(this.config),
      this.config.timeoutMs
    );
    return {
      provider: this.provider,
      model: this.model,
      raw: normalizeDecision(extractOpenAICompatiblePayload(response))
    };
  }

  supportsTools(): boolean {
    return true;
  }

  supportsJsonMode(): boolean {
    return this.config.structuredOutput !== "tool_call";
  }
}

export class AnthropicMessagesAdapter implements ModelAdapter {
  provider = "anthropic";
  model: string;

  constructor(private readonly config: AnthropicProviderConfig) {
    this.model = config.modelId;
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const response = await postJson(
      joinUrl(this.config.baseUrl, "v1/messages"),
      anthropicBody(this.config, request),
      {
        ...authorizationHeaders(this.config, "x-api-key"),
        "anthropic-version": "2023-06-01"
      },
      this.config.timeoutMs
    );
    return {
      provider: this.provider,
      model: this.model,
      raw: normalizeDecision(extractAnthropicPayload(response))
    };
  }

  supportsTools(): boolean {
    return true;
  }

  supportsJsonMode(): boolean {
    return this.config.structuredOutput === "plain_json";
  }
}
