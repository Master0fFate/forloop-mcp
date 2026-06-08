import type { ModelAdapter, ModelRequest, ModelResponse } from "./base.js";

function hasToolResult(request: ModelRequest, tool: string, predicate?: (output: unknown) => boolean): boolean {
  return request.events.some((event) => {
    if (event.type !== "tool_result") {
      return false;
    }
    const payload = event.payload as { result?: { tool?: string; output?: unknown } };
    if (payload.result?.tool !== tool) {
      return false;
    }
    return predicate ? predicate(payload.result.output) : true;
  });
}

function latestTestsPassed(request: ModelRequest): boolean {
  const results = request.events
    .filter((event) => event.type === "tool_result")
    .map((event) => event.payload as { result?: { tool?: string; output?: unknown } })
    .filter((payload) => payload.result?.tool === "repo.run_tests");

  const latest = results.at(-1)?.result?.output as { passed?: boolean } | undefined;
  return latest?.passed === true;
}

export class MockModelAdapter implements ModelAdapter {
  provider = "mock";
  model = "deterministic-debugger";

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const raw = this.nextDecision(request);
    return { provider: this.provider, model: this.model, raw };
  }

  supportsTools(): boolean {
    return true;
  }

  supportsJsonMode(): boolean {
    return true;
  }

  private nextDecision(request: ModelRequest): unknown {
    if (!hasToolResult(request, "repo.run_tests")) {
      return {
        status: "continue",
        summary: "First reproduce the failing test before changing code.",
        next_action: {
          type: "tool_call",
          tool: "repo.run_tests",
          args: { command: request.task.testCommand }
        },
        confidence: 0.86,
        risk: "low",
        requires_human_approval: false
      };
    }

    if (latestTestsPassed(request)) {
      return {
        status: "final",
        summary: "The configured test command now passes after the password validation fix.",
        final_answer: "Fixed the password validator so empty or whitespace-only passwords are rejected, then reran the configured tests successfully.",
        confidence: 0.93,
        risk: "low",
        requires_human_approval: false
      };
    }

    if (!hasToolResult(request, "repo.read_file")) {
      return {
        status: "continue",
        summary: "The failing scenario points at the password validator implementation.",
        next_action: {
          type: "tool_call",
          tool: "repo.read_file",
          args: { path: "src/validatePassword.js" }
        },
        confidence: 0.8,
        risk: "low",
        requires_human_approval: false
      };
    }

    if (!hasToolResult(request, "repo.apply_patch")) {
      return {
        status: "continue",
        summary: "The validator accepts empty strings because it only checks for undefined.",
        next_action: {
          type: "tool_call",
          tool: "repo.apply_patch",
          args: {
            edits: [
              {
                path: "src/validatePassword.js",
                search: "export function validatePassword(password) {\n  return password !== undefined;\n}\n",
                replace:
                  "export function validatePassword(password) {\n  return typeof password === \"string\" && password.trim().length > 0;\n}\n"
              }
            ]
          }
        },
        confidence: 0.88,
        risk: "medium",
        requires_human_approval: true
      };
    }

    return {
      status: "continue",
      summary: "The patch is applied; rerun the configured tests to verify.",
      next_action: {
        type: "tool_call",
        tool: "repo.run_tests",
        args: { command: request.task.testCommand }
      },
      confidence: 0.84,
      risk: "low",
      requires_human_approval: false
    };
  }
}
