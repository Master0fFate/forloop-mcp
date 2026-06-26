import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { ShellTools } from "../src/tools/shell.js";

describe("shell tools", () => {
  test("denies arbitrary shell execution by default", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "forloop-shell-deny-"));
    const tools = new ShellTools(workspace);

    try {
      const result = await tools.run({
        command: process.execPath,
        args: ["-e", "console.log('should-not-run')"]
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain("disabled by default");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("runs explicitly allowed commands inside the workspace", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "forloop-shell-allow-"));
    const tools = new ShellTools(workspace, {
      enabled: true,
      allowedCommands: [process.execPath],
      timeoutMs: 5000
    });

    try {
      const result = await tools.run({
        command: process.execPath,
        args: ["-e", "console.log(process.cwd())"]
      });

      expect(result.ok).toBe(true);
      const output = result.output as { cwd?: string; stdout?: string };
      expect(output.cwd).toBe(workspace);
      expect(output.stdout).toContain(workspace);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("rejects command working directories outside the workspace", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "forloop-shell-cwd-"));
    const workspace = join(tempRoot, "workspace");
    const tools = new ShellTools(workspace, {
      enabled: true,
      allowedCommands: [process.execPath],
      timeoutMs: 5000
    });

    try {
      const result = await tools.run({
        command: process.execPath,
        args: ["-e", "console.log('nope')"],
        cwd: ".."
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain("escapes workspace");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
