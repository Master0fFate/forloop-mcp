import { resolve } from "node:path";
import type { Command } from "commander";
import { loadForLoopConfig, mergeShellPolicy } from "../config/forloop-config.js";
import { SessionMemoryStore } from "../memory/store.js";
import { startRepoMcpServer } from "../mcp/repo-server.js";
import { resolveSessionIdentity } from "../orchestrator/session.js";
import { ShellTools } from "../tools/shell.js";
import { createForLoopWebServer } from "../web/server.js";
import { shellPolicyFromOptions, stringArray, stringOption } from "./options.js";

type ServiceCommandOptions = Readonly<Record<string, unknown>>;

export function registerServiceCommands(program: Command): void {
  program
    .command("mcp-repo")
    .description("Start the repo MCP server over stdio.")
    .option("--workspace <path>", "Workspace path", ".")
    .option("--test-command <command>", "Configured test command", "npm test")
    .option("--typecheck-command <command>", "Optional configured typecheck command")
    .option("--allowed-tool <name...>", "Restrict MCP calls to allowed tool names")
    .option("--allow-mutations", "Allow direct MCP mutation tools such as repo.apply_patch")
    .option("--allow-shell", "Enable governed shell.run calls")
    .option("--allow-arbitrary-shell", "Allow shell.run commands beyond --shell-command values")
    .option("--allow-shell-mode", "Allow shell.run mode=shell")
    .option("--shell-command <command...>", "Executable paths/names allowed when shell is enabled")
    .option("--config <path>", "Optional ForLoop config YAML for shell policy")
    .option("--session-id <id>", "Stable session id exposed in this MCP server instance name")
    .action(async (options: ServiceCommandOptions) => {
      const workspace = resolve(typeof options.workspace === "string" ? options.workspace : ".");
      const config = await loadForLoopConfig({ workspace, configPath: stringOption(options.config) });
      const shellPolicy = mergeShellPolicy(config.shell, shellPolicyFromOptions(options));
      await startRepoMcpServer(
        workspace,
        typeof options.testCommand === "string" ? options.testCommand : "npm test",
        stringOption(options.typecheckCommand),
        {
          allowedTools: Array.isArray(options.allowedTool)
            ? options.allowedTool.filter((item): item is string => typeof item === "string")
            : undefined,
          allowMutations: options.allowMutations === true,
          allowShell: shellPolicy.enabled === true,
          allowArbitraryShell: shellPolicy.allowArbitrary === true,
          allowShellMode: shellPolicy.allowShellMode === true,
          shellAllowedCommands: shellPolicy.allowedCommands ? [...shellPolicy.allowedCommands] : undefined,
          sessionId: stringOption(options.sessionId)
        }
      );
    });

  program
    .command("web")
    .description("Start the local ForLoop web console.")
    .option("--workspace <path>", "Workspace path", ".")
    .option("--host <host>", "Host to bind", "127.0.0.1")
    .option("--port <port>", "Port to bind", "4317")
    .option("--session-id <id>", "Stable session id for UI memory and status")
    .option("--config <path>", "Optional ForLoop config YAML")
    .option("--allow-shell", "Enable governed shell execution in the UI")
    .option("--allow-arbitrary-shell", "Allow shell commands beyond --shell-command values")
    .option("--allow-shell-mode", "Allow shell mode in the UI shell runner")
    .option("--shell-command <command...>", "Executable paths/names allowed when shell is enabled")
    .action(async (options: ServiceCommandOptions) => {
      const workspace = resolve(typeof options.workspace === "string" ? options.workspace : ".");
      const config = await loadForLoopConfig({ workspace, configPath: stringOption(options.config) });
      const shellPolicy = mergeShellPolicy(config.shell, shellPolicyFromOptions(options));
      const server = await createForLoopWebServer({
        workspace,
        host: typeof options.host === "string" ? options.host : "127.0.0.1",
        port: Number(options.port),
        sessionId: stringOption(options.sessionId),
        providerConfig: config.provider,
        shellPolicy
      });
      console.log(`ForLoop web console: ${server.url}`);
      await new Promise<void>((resolveStop) => {
        const stop = async () => {
          await server.close();
          resolveStop();
        };
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
      });
    });

  program
    .command("memory")
    .description("Read or write session-isolated long-term memory.")
    .argument("<action>", "remember, search, list, or delete")
    .option("--workspace <path>", "Workspace path", ".")
    .option("--session-id <id>", "Stable session id", "power-user")
    .option("--content <text>", "Memory content for remember")
    .option("--query <text>", "Search query")
    .option("--tag <tag...>", "Memory tag. Repeat or pass multiple values.")
    .option("--id <id>", "Memory id for delete")
    .option("--limit <count>", "Maximum records", "20")
    .action(async (action: string, options: ServiceCommandOptions) => {
      const workspace = resolve(typeof options.workspace === "string" ? options.workspace : ".");
      const session = resolveSessionIdentity(typeof options.sessionId === "string" ? options.sessionId : "power-user");
      const store = await SessionMemoryStore.open({ workspace, session });
      try {
        if (action === "remember") {
          if (!options.content) {
            throw new Error("--content is required for memory remember.");
          }
          console.log(JSON.stringify(store.remember({ content: String(options.content), tags: stringArray(options.tag) }), null, 2));
          return;
        }
        if (action === "search") {
          console.log(
            JSON.stringify(
              store.search({ query: stringOption(options.query), tag: stringArray(options.tag)[0], limit: Number(options.limit) }),
              null,
              2
            )
          );
          return;
        }
        if (action === "list") {
          console.log(JSON.stringify(store.list({ tag: stringArray(options.tag)[0], limit: Number(options.limit) }), null, 2));
          return;
        }
        if (action === "delete") {
          if (!options.id) {
            throw new Error("--id is required for memory delete.");
          }
          console.log(JSON.stringify({ deleted: store.delete(String(options.id)) }, null, 2));
          return;
        }
        throw new Error(`Unknown memory action: ${action}`);
      } finally {
        store.close();
      }
    });

  program
    .command("shell")
    .description("Run a governed workspace command.")
    .requiredOption("--command <command>", "Executable path/name to run")
    .option("--arg <arg...>", "Command arguments")
    .option("--workspace <path>", "Workspace path", ".")
    .option("--cwd <path>", "Working directory inside the workspace", ".")
    .option("--config <path>", "Optional ForLoop config YAML")
    .option("--allow-shell", "Enable shell execution for this command")
    .option("--allow-arbitrary-shell", "Allow command beyond --shell-command values")
    .option("--shell-command <command...>", "Executable paths/names allowed when shell is enabled")
    .action(async (options: ServiceCommandOptions) => {
      const workspace = resolve(typeof options.workspace === "string" ? options.workspace : ".");
      const config = await loadForLoopConfig({ workspace, configPath: stringOption(options.config) });
      const shellPolicy = mergeShellPolicy(config.shell, shellPolicyFromOptions(options));
      const shell = new ShellTools(workspace, shellPolicy);
      const result = await shell.run({
        command: String(options.command),
        args: stringArray(options.arg),
        cwd: typeof options.cwd === "string" ? options.cwd : "."
      });
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.ok ? 0 : 1;
    });
}
