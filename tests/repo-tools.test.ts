import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { RepoTools } from "../src/tools/repo.js";

describe("repo tools", () => {
  test("rejects paths that escape the workspace", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "forloop-path-test-"));
    const workspace = join(tempRoot, "workspace");
    const outside = join(tempRoot, "outside.txt");
    writeFileSync(outside, "secret", "utf8");

    const tools = new RepoTools(workspace, "npm test");

    try {
      expect(() => tools.resolveInsideWorkspace("../outside.txt")).toThrow("Path escapes workspace");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
