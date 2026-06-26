import { spawn } from "node:child_process";
import { isAbsolute, relative, resolve } from "node:path";
import type { ToolResult } from "../orchestrator/schemas.js";

export interface ShellPolicy {
  readonly enabled?: boolean;
  readonly allowArbitrary?: boolean;
  readonly allowShellMode?: boolean;
  readonly allowedCommands?: readonly string[];
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

export interface ShellRunInput {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly mode?: "exec" | "shell";
  readonly timeoutMs?: number;
  readonly env?: Record<string, string>;
}

interface ShellRunResult {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly mode: "exec" | "shell";
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

const defaultPolicy: Required<Pick<ShellPolicy, "enabled" | "allowArbitrary" | "allowShellMode">> = {
  enabled: false,
  allowArbitrary: false,
  allowShellMode: false
};

export class ShellTools {
  readonly workspace: string;
  readonly policy: ShellPolicy;

  constructor(workspace: string, policy: ShellPolicy = {}) {
    this.workspace = resolve(workspace);
    this.policy = { ...defaultPolicy, ...policy };
  }

  async run(input: ShellRunInput): Promise<ToolResult> {
    const mode = input.mode ?? "exec";
    const args = input.args ?? [];
    const command = input.command.trim();

    if (!this.policy.enabled) {
      return this.fail("Shell tools are disabled by default. Restart with explicit shell-tool enablement.");
    }
    if (!command) {
      return this.fail("Command is required.");
    }
    if (mode === "shell" && !this.policy.allowShellMode) {
      return this.fail("Shell mode is disabled by policy. Use structured args or enable shell mode explicitly.");
    }
    if (!this.policy.allowArbitrary && !this.isAllowedCommand(command)) {
      return this.fail(`Command is not allowed by shell policy: ${command}`);
    }

    let cwd: string;
    try {
      cwd = this.resolveInsideWorkspace(input.cwd ?? ".");
    } catch (error) {
      return this.fail(error instanceof Error ? error.message : String(error));
    }
    const timeoutMs = input.timeoutMs ?? this.policy.timeoutMs ?? 30000;
    const maxOutputBytes = this.policy.maxOutputBytes ?? 12000;
    const result = await this.runProcess({
      command,
      args,
      cwd,
      mode,
      timeoutMs,
      maxOutputBytes,
      env: input.env
    });

    return {
      tool: "shell.run",
      ok: result.exitCode === 0 && !result.timedOut,
      output: result,
      error: result.exitCode === 0 && !result.timedOut ? undefined : result.stderr || `Command exited ${result.exitCode}`
    };
  }

  status(): { readonly enabled: boolean; readonly allowArbitrary: boolean; readonly allowShellMode: boolean } {
    return {
      enabled: this.policy.enabled === true,
      allowArbitrary: this.policy.allowArbitrary === true,
      allowShellMode: this.policy.allowShellMode === true
    };
  }

  private isAllowedCommand(command: string): boolean {
    return (this.policy.allowedCommands ?? []).includes(command);
  }

  private resolveInsideWorkspace(relativePath: string): string {
    const fullPath = resolve(this.workspace, relativePath);
    const relativeToWorkspace = relative(this.workspace, fullPath);
    if (relativeToWorkspace.startsWith("..") || isAbsolute(relativeToWorkspace)) {
      throw new Error(`Command working directory escapes workspace: ${relativePath}`);
    }
    return fullPath;
  }

  private runProcess(input: {
    readonly command: string;
    readonly args: readonly string[];
    readonly cwd: string;
    readonly mode: "exec" | "shell";
    readonly timeoutMs: number;
    readonly maxOutputBytes: number;
    readonly env?: Record<string, string>;
  }): Promise<ShellRunResult> {
    return new Promise((resolveCommand) => {
      let timedOut = false;
      const child = spawn(input.command, input.mode === "shell" ? [] : [...input.args], {
        cwd: input.cwd,
        env: { ...process.env, ...input.env },
        shell: input.mode === "shell",
        windowsHide: true
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, input.timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout = trimOutput(stdout + chunk.toString(), input.maxOutputBytes);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = trimOutput(stderr + chunk.toString(), input.maxOutputBytes);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolveCommand({
          command: input.command,
          args: input.args,
          cwd: input.cwd,
          mode: input.mode,
          exitCode: timedOut ? 124 : code ?? 1,
          stdout,
          stderr,
          timedOut
        });
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        resolveCommand({
          command: input.command,
          args: input.args,
          cwd: input.cwd,
          mode: input.mode,
          exitCode: 1,
          stdout,
          stderr: error.message,
          timedOut
        });
      });
    });
  }

  private fail(error: string): ToolResult {
    return { tool: "shell.run", ok: false, error };
  }
}

function trimOutput(output: string, maxBytes: number): string {
  return output.length > maxBytes ? output.slice(-maxBytes) : output;
}
