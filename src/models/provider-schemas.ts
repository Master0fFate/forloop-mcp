import { z } from "zod";

const HttpUrlSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith("http://") || value.startsWith("https://"), {
    message: "Provider baseUrl must be an http(s) URL."
  });

const CommonHttpProviderSchema = z.object({
  modelId: z.string().min(1),
  apiKey: z.string().min(1).optional(),
  apiKeyEnv: z.string().min(1).optional(),
  timeoutMs: z.coerce.number().int().positive().default(60000),
  headers: z.record(z.string(), z.string()).default({})
});

export const OpenAICompatibleProviderConfigSchema = CommonHttpProviderSchema.extend({
  kind: z.literal("openai-compatible"),
  baseUrl: HttpUrlSchema,
  structuredOutput: z.enum(["json_schema", "json_object", "tool_call", "plain_json"]).default("json_schema")
});

export const AnthropicProviderConfigSchema = CommonHttpProviderSchema.extend({
  kind: z.literal("anthropic"),
  baseUrl: HttpUrlSchema.default("https://api.anthropic.com"),
  structuredOutput: z.enum(["tool_use", "plain_json"]).default("tool_use")
});

export const MockProviderConfigSchema = z.object({
  kind: z.literal("mock")
});

export const ProviderConfigSchema = z.discriminatedUnion("kind", [
  MockProviderConfigSchema,
  OpenAICompatibleProviderConfigSchema,
  AnthropicProviderConfigSchema
]);

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type OpenAICompatibleProviderConfig = z.infer<typeof OpenAICompatibleProviderConfigSchema>;
export type AnthropicProviderConfig = z.infer<typeof AnthropicProviderConfigSchema>;

export function redactProviderConfig<TConfig extends ProviderConfig>(config: TConfig): TConfig {
  const copy = { ...config };
  if ("headers" in copy && copy.headers) {
    copy.headers = Object.fromEntries(Object.keys(copy.headers).map((key) => [key, "[redacted]"]));
  }
  if ("apiKey" in copy && copy.apiKey) {
    return { ...copy, apiKey: "[redacted]" } as TConfig;
  }
  return copy;
}
