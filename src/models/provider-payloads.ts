import type { ModelRequest } from "./base.js";
import type { AnthropicProviderConfig, OpenAICompatibleProviderConfig } from "./provider-schemas.js";
import { parseAgentDecision } from "../orchestrator/decision.js";

const agentDecisionJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["continue", "final", "failed", "needs_human"] },
    summary: { type: "string" },
    next_action: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          properties: {
            type: { type: "string", enum: ["tool_call"] },
            tool: { type: "string" },
            args: { type: "object", additionalProperties: true }
          },
          required: ["type", "tool", "args"]
        },
        { type: "null" }
      ]
    },
    final_answer: { anyOf: [{ type: "string" }, { type: "null" }] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    risk: { type: "string", enum: ["low", "medium", "high"] },
    requires_human_approval: { type: "boolean" }
  },
  required: ["status", "summary", "next_action", "final_answer", "confidence", "risk", "requires_human_approval"]
} as const;

export function openAICompatibleBody(config: OpenAICompatibleProviderConfig, request: ModelRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: config.modelId,
    messages: [
      { role: "system", content: systemPrompt() },
      { role: "user", content: userPrompt(request) }
    ],
    temperature: 0
  };

  if (config.structuredOutput === "json_schema") {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: "forloop_agent_decision",
        strict: true,
        schema: agentDecisionJsonSchema
      }
    };
  }
  if (config.structuredOutput === "json_object") {
    body.response_format = { type: "json_object" };
  }
  if (config.structuredOutput === "tool_call") {
    body.tools = [
      {
        type: "function",
        function: {
          name: "forloop_agent_decision",
          description: "Return the next ForLoop agent decision.",
          parameters: agentDecisionJsonSchema
        }
      }
    ];
    body.tool_choice = { type: "function", function: { name: "forloop_agent_decision" } };
  }

  return body;
}

export function anthropicBody(config: AnthropicProviderConfig, request: ModelRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: config.modelId,
    max_tokens: 2048,
    system: systemPrompt(),
    messages: [{ role: "user", content: userPrompt(request) }]
  };

  if (config.structuredOutput === "tool_use") {
    body.tools = [
      {
        name: "forloop_agent_decision",
        description: "Return the next ForLoop agent decision.",
        input_schema: agentDecisionJsonSchema
      }
    ];
    body.tool_choice = { type: "tool", name: "forloop_agent_decision" };
  }

  return body;
}

export function extractOpenAICompatiblePayload(response: unknown): unknown {
  const root = requireRecord(response, "OpenAI-compatible response");
  const choices = root.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error("OpenAI-compatible response did not include choices.");
  }
  const first = requireRecord(choices[0], "OpenAI-compatible choice");
  const message = requireRecord(first.message, "OpenAI-compatible message");
  const toolCalls = message.tool_calls;
  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    const toolCall = requireRecord(toolCalls[0], "OpenAI-compatible tool call");
    const fn = requireRecord(toolCall.function, "OpenAI-compatible function call");
    return fn.arguments;
  }
  return message.content;
}

export function extractAnthropicPayload(response: unknown): unknown {
  const root = requireRecord(response, "Anthropic response");
  const content = root.content;
  if (!Array.isArray(content)) {
    throw new Error("Anthropic response did not include content blocks.");
  }
  const toolUse = content
    .map((block) => requireRecord(block, "Anthropic content block"))
    .find((block) => block.type === "tool_use" && block.name === "forloop_agent_decision");
  if (toolUse) {
    return toolUse.input;
  }
  return content
    .map((block) => requireRecord(block, "Anthropic content block"))
    .find((block) => block.type === "text")?.text;
}

export function normalizeDecision(payload: unknown): unknown {
  const parsedPayload = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (parsedPayload && typeof parsedPayload === "object" && !Array.isArray(parsedPayload)) {
    const copy: Record<string, unknown> = { ...(parsedPayload as Record<string, unknown>) };
    if (copy.next_action === null) {
      delete copy.next_action;
    }
    if (copy.final_answer === null) {
      delete copy.final_answer;
    }
    const parsed = parseAgentDecision(copy);
    if (!parsed.ok) {
      throw new Error(`Provider response did not match ForLoop decision schema: ${parsed.error}`);
    }
    return parsed.decision;
  }
  throw new Error("Provider response did not contain a JSON decision object.");
}

function systemPrompt(): string {
  return [
    "You are driving a ForLoop MCP task.",
    "Return exactly one JSON object matching the supplied agent decision schema.",
    "Use status=continue with a next_action when another tool should run.",
    "Use status=final only when the task is genuinely complete."
  ].join(" ");
}

function userPrompt(request: ModelRequest): string {
  return JSON.stringify(
    {
      goal: request.task.goal,
      workspace: request.task.workspace,
      skill: { name: request.skill.name, content: request.skill.content },
      availableTools: request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        mutates: tool.mutates
      })),
      stateSummary: request.stateSummary
    },
    null,
    2
  );
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} was not an object.`);
  }
  return value as Record<string, unknown>;
}
