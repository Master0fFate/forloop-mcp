import type { ModelAdapter } from "./base.js";
import { MockModelAdapter } from "./mock.js";
import { OpenAIAdapter } from "./openai.js";

export function createModelAdapter(name: "mock" | "openai"): ModelAdapter {
  if (name === "openai") {
    return new OpenAIAdapter();
  }
  return new MockModelAdapter();
}
