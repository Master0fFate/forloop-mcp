import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import type { ToolResult } from "../orchestrator/schemas.js";

const ignoredDirs = new Set([".git", ".forloop", "node_modules", "dist", "coverage"]);
const textExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml"
]);

const EditSchema = z.object({
  path: z.string().min(1),
  search: z.string().min(1),
  replace: z.string()
});

const ApplyPatchArgsSchema = z.object({
  edits: z.array(EditSchema).min(1)
});

export class RepoTools {
  readonly workspace: string;

  constructor(workspace: string, private readonly testCommand: string) {
    this.workspace = resolve(workspace);
  }

  async listFiles(args: { limit?: number } = {}): Promise<ToolResult> {
    const files = await this.walk(this.workspace);
    return this.ok("repo.list_files", {
      files: files.slice(0, args.limit ?? 200),
      total: files.length
    });
  }

  async readFile(args: { path: string; maxBytes?: number }): Promise<ToolResult> {
    const fullPath = this.resolveInsideWorkspace(args.path);
    const content = await readFile(fullPath, "utf8");
    const maxBytes = args.maxBytes ?? 12000;
    return this.ok("repo.read_file", {
      path: args.path,
      content: content.slice(0, maxBytes),
      truncated: Buffer.byteLength(content, "utf8") > maxBytes
    });
  }

  async searchCode(args: { query: string; limit?: number }): Promise<ToolResult> {
    const files = await this.walk(this.workspace);
    const limit = args.limit ?? 50;
    const matches: Array<{ path: string; line: number; text: string }> = [];

    for (const file of files) {
      if (matches.length >= limit) {
        break;
      }
      const fullPath = this.resolveInsideWorkspace(file);
      if (!textExtensions.has(extname(fullPath)) && basename(fullPath) !== "package.json") {
        continue;
      }
      const content = await readFile(fullPath, "utf8").catch(() => "");
      content.split(/\r?\n/).forEach((line, index) => {
        if (matches.length < limit && line.includes(args.query)) {
          matches.push({ path: file, line: index + 1, text: line });
        }
      });
    }

    return this.ok("repo.search_code", { query: args.query, matches });
  }

  async applyPatch(args: unknown): Promise<ToolResult> {
    const parsed = ApplyPatchArgsSchema.safeParse(args);
    if (!parsed.success) {
      return this.fail("repo.apply_patch", parsed.error.issues.map((issue) => issue.message).join("; "));
    }

    const prepared = parsed.data.edits.map((edit) => {
      const fullPath = this.resolveInsideWorkspace(edit.path);
      return { ...edit, fullPath };
    });

    const nextContents = new Map<string, string>();
    for (const edit of prepared) {
      const current = nextContents.get(edit.fullPath) ?? (await readFile(edit.fullPath, "utf8"));
      const occurrences = current.split(edit.search).length - 1;
      if (occurrences !== 1) {
        return this.fail(
          "repo.apply_patch",
          `Expected exactly one match for ${edit.path}, found ${occurrences}.`
        );
      }
      nextContents.set(edit.fullPath, current.replace(edit.search, edit.replace));
    }

    for (const [fullPath, content] of nextContents) {
      await writeFile(fullPath, content, "utf8");
    }

    return this.ok("repo.apply_patch", {
      editedFiles: [...new Set(prepared.map((edit) => edit.path))],
      editCount: prepared.length
    });
  }

  async runTests(args: { command?: string } = {}): Promise<ToolResult> {
    const command = args.command ?? this.testCommand;
    if (command !== this.testCommand) {
      return this.fail("repo.run_tests", `Only the configured test command is allowed: ${this.testCommand}`);
    }

    const result = await this.runCommand(command);
    return this.ok("repo.run_tests", {
      command,
      passed: result.exitCode === 0,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr
    });
  }

  async gitDiff(): Promise<ToolResult> {
    if (!existsSync(join(this.workspace, ".git"))) {
      return this.ok("repo.git_diff", { diff: "", note: "Workspace is not a git repository." });
    }
    const result = await this.runCommand("git diff --");
    return this.ok("repo.git_diff", {
      diff: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode
    });
  }

  resolveInsideWorkspace(relativePath: string): string {
    const fullPath = resolve(this.workspace, relativePath);
    const relativeToWorkspace = relative(this.workspace, fullPath);

    if (relativeToWorkspace.startsWith("..") || isAbsolute(relativeToWorkspace)) {
      throw new Error(`Path escapes workspace: ${relativePath}`);
    }
    return fullPath;
  }

  private async walk(dir: string, prefix = ""): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entry.name)) {
          files.push(...(await this.walk(join(dir, entry.name), join(prefix, entry.name))));
        }
        continue;
      }
      files.push(join(prefix, entry.name).replaceAll("\\", "/"));
    }

    return files.sort();
  }

  private runCommand(command: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolveCommand) => {
      const child = spawn(command, {
        cwd: this.workspace,
        shell: true,
        windowsHide: true
      });
      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on("close", (code) => {
        resolveCommand({
          exitCode: code ?? 1,
          stdout: stdout.slice(-12000),
          stderr: stderr.slice(-12000)
        });
      });
    });
  }

  private ok(tool: string, output: unknown): ToolResult {
    return { tool, ok: true, output };
  }

  private fail(tool: string, error: string): ToolResult {
    return { tool, ok: false, error };
  }
}
