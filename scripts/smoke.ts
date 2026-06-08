import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "..");
const sourceFixture = join(projectRoot, "examples", "buggy-auth-service");
const tempRoot = mkdtempSync(join(tmpdir(), "forloop-smoke-"));
const workspace = join(tempRoot, "buggy-auth-service");

try {
  cpSync(sourceFixture, workspace, { recursive: true });
  const tsxCli = resolve(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");
  if (!existsSync(tsxCli)) {
    throw new Error("tsx CLI not found. Run npm install first.");
  }

  const result = spawnSync(
    process.execPath,
    [
      tsxCli,
      "src/cli/main.ts",
      "run",
      "--workspace",
      workspace,
      "--goal",
      "Fix the failing password validation tests",
      "--skill",
      "repo-debugging",
      "--model",
      "mock",
      "--test-command",
      "npm test",
      "--auto-approve",
      "--max-iterations",
      "8"
    ],
    {
      cwd: projectRoot,
      encoding: "utf8"
    }
  );

  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error(`Smoke CLI failed with exit code ${result.status}`);
  }

  const fixedFile = readFileSync(join(workspace, "src", "validatePassword.js"), "utf8");
  if (!fixedFile.includes("password.trim().length > 0")) {
    throw new Error("Smoke CLI completed but did not apply the expected fix.");
  }

  if (!result.stdout.includes("completed")) {
    throw new Error(`Smoke CLI did not report completion:\n${result.stdout}`);
  }

  console.log(result.stdout.trim());
  console.log("Smoke test passed.");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
