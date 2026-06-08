import type { TaskEvent, TaskInput } from "../orchestrator/schemas.js";
import type { LoadedSkill } from "../skills/loader.js";
import type { ToolDescription } from "../tools/registry.js";

export interface ModelRequest {
  task: TaskInput;
  skill: LoadedSkill;
  tools: ToolDescription[];
  events: TaskEvent[];
  stateSummary: string;
}

export interface ModelResponse {
  provider: string;
  model: string;
  raw: unknown;
}

export interface ModelAdapter {
  provider: string;
  model: string;
  generate(request: ModelRequest): Promise<ModelResponse>;
  supportsTools(): boolean;
  supportsJsonMode(): boolean;
}
