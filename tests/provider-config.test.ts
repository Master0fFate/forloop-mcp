import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, test } from "vitest";
import { createModelAdapterFromConfig, ProviderConfigSchema, redactProviderConfig } from "../src/models/provider-config.js";

const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        })
    )
  );
  servers.length = 0;
});

describe("provider configuration", () => {
  test("accepts custom OpenAI-compatible base URLs and caller supplied model IDs", () => {
    const parsed = ProviderConfigSchema.parse({
      kind: "openai-compatible",
      baseUrl: "http://localhost:11434/v1",
      modelId: "local-model-id",
      apiKey: "local-placeholder",
      structuredOutput: "json_schema"
    });

    expect(parsed.modelId).toBe("local-model-id");
    expect(redactProviderConfig(parsed)).toMatchObject({
      kind: "openai-compatible",
      apiKey: "[redacted]"
    });
  });

  test("accepts friendly provider configs for Anthropic and OpenRouter", () => {
    const anthropic = ProviderConfigSchema.parse({
      kind: "anthropic",
      baseUrl: "https://api.anthropic.com",
      modelId: "manual-anthropic-model",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      structuredOutput: "tool_use"
    });
    const openrouter = ProviderConfigSchema.parse({
      kind: "openai-compatible",
      baseUrl: "https://openrouter.ai/api/v1",
      modelId: "author/model-slug",
      apiKeyEnv: "OPENROUTER_API_KEY",
      structuredOutput: "json_schema"
    });

    expect(anthropic).toMatchObject({ kind: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY" });
    expect(openrouter).toMatchObject({ kind: "openai-compatible", apiKeyEnv: "OPENROUTER_API_KEY" });
  });

  test("rejects malformed provider configs with actionable schema errors", () => {
    const parsed = ProviderConfigSchema.safeParse({
      kind: "openai-compatible",
      baseUrl: "not a url"
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((issue) => issue.path.join("."))).toContain("modelId");
      expect(parsed.error.issues.map((issue) => issue.path.join("."))).toContain("baseUrl");
    }
  });

  test("normalizes live OpenAI-compatible responses into the agent decision schema", async () => {
    let capturedBody: unknown;
    const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
      if (request.url !== "/v1/chat/completions") {
        response.writeHead(404).end();
        return;
      }

      capturedBody = JSON.parse(await readBody(request));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: "chatcmpl-test",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  status: "final",
                  summary: "Validated provider round trip.",
                  final_answer: "Provider returned structured JSON.",
                  confidence: 0.91,
                  risk: "low",
                  requires_human_approval: false
                })
              }
            }
          ]
        })
      );
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    const adapter = createModelAdapterFromConfig({
      kind: "openai-compatible",
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      modelId: "manual-model-id",
      apiKey: "test-key",
      structuredOutput: "json_schema"
    });

    const result = await adapter.generate({
      task: {
        goal: "Validate provider",
        workspace: ".",
        skill: "repo-debugging",
        model: "mock",
        testCommand: "npm test",
        approvalMode: "auto",
        quality: {
          minStepScore: 0.2,
          minFinalConfidence: 0,
          requireEvidenceBeforeFinal: false,
          requireTestsPassed: false,
          requireTypecheckPassed: false
        },
        governance: {
          escalateHighRisk: true,
          recoverOnFailedStep: true,
          maxRecoveryAttempts: 3,
          maxFinalRejections: 2,
          maxConsecutiveFailedSteps: 3
        },
        security: { allowedTools: [], requireApprovalForMutations: true },
        evaluationCriteria: [],
        budget: { maxIterations: 1, maxInvalidDecisions: 2, maxRepeatedActions: 3, maxEmptyRounds: 2 }
      },
      skill: { name: "repo-debugging", path: "test", content: "test" },
      tools: [],
      events: [],
      stateSummary: "No state yet."
    });

    expect(result.raw).toMatchObject({ status: "final", final_answer: "Provider returned structured JSON." });
    expect(capturedBody).toMatchObject({
      model: "manual-model-id",
      response_format: { type: "json_schema" }
    });
  });
});

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}
