import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, test } from "vitest";

const projectRoot = resolve(import.meta.dirname, "..");

describe("repo MCP server", () => {
  test("lists and calls repo tools over stdio", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "forloop-mcp-test-"));
    const workspace = join(tempRoot, "buggy-auth-service");
    cpSync(join(projectRoot, "examples", "buggy-auth-service"), workspace, { recursive: true });

    const client = new Client({ name: "forloop-test-client", version: "0.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        resolve(projectRoot, "node_modules", "tsx", "dist", "cli.mjs"),
        "src/mcp/repo-server.ts",
        `--workspace=${workspace}`,
        "--test-command=npm test"
      ],
      cwd: projectRoot,
      stderr: "pipe"
    });

    try {
      await client.connect(transport);
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toContain("repo.read_file");

      const result = await client.callTool({
        name: "repo.list_files",
        arguments: { limit: 20 }
      });
      const text = result.content.find((content) => content.type === "text")?.text ?? "";
      expect(text).toContain("src/validatePassword.js");

      const denied = await client.callTool({
        name: "repo.apply_patch",
        arguments: {
          edits: [
            {
              path: "src/validatePassword.js",
              search: "return password !== undefined;",
              replace: "return true;"
            }
          ]
        }
      });
      const deniedText = denied.content.find((content) => content.type === "text")?.text ?? "";
      expect(deniedText).toContain("Direct MCP mutations are disabled");
    } finally {
      await client.close();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
