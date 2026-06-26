import ky, { HTTPError } from "ky";
import type { AnthropicProviderConfig, OpenAICompatibleProviderConfig } from "./provider-schemas.js";

export function authorizationHeaders(
  config: OpenAICompatibleProviderConfig | AnthropicProviderConfig,
  apiKeyHeader = "authorization"
): Record<string, string> {
  const apiKey = config.apiKey ?? (config.apiKeyEnv ? process.env[config.apiKeyEnv] : undefined);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...config.headers
  };
  if (!apiKey) {
    return headers;
  }
  headers[apiKeyHeader] = apiKeyHeader === "authorization" ? `Bearer ${apiKey}` : apiKey;
  return headers;
}

export async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<unknown> {
  try {
    return await ky
      .post(url, {
        headers,
        json: body,
        timeout: timeoutMs
      })
      .json();
  } catch (error) {
    if (error instanceof HTTPError) {
      const text = await error.response.text();
      throw new Error(`Provider request failed with HTTP ${error.response.status}: ${text.slice(0, 500)}`);
    }
    throw error;
  }
}

export function joinUrl(baseUrl: string, suffix: string): string {
  return `${baseUrl.replace(/\/+$/u, "")}/${suffix.replace(/^\/+/u, "")}`;
}
