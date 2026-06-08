#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Command } from "commander";
import YAML from "yaml";
import { runAgentLoop } from "../orchestrator/loop.js";
import { TaskInputSchema, type TaskInput } from "../orchestrator/schemas.js";
import { SQLiteStateStore } from "../storage/sqlite.js";
import { startRepoMcpServer } from "../mcp/repo-server.js";

const program = new Command();

program
  .name("forloop")
  .description("Model-agnostic agent loop runtime with MCP repo tools.")
  .version("0.1.8");

program
  .command("init")
  .description("Create a starter task YAML in the selected workspace.")
  .option("--workspace <path>", "Workspace to initialize", ".")
  .option("--out <path>", "Output task YAML path")
  .action(async (options: { workspace: string; out?: string }) => {
    const workspace = resolve(options.workspace);
    const out = resolve(options.out ?? join(workspace, "forloop.task.yaml"));
    const task: TaskInput = TaskInputSchema.parse({
      goal: "Fix failing tests",
      workspace,
      skill: "repo-debugging",
      model: "mock",
      testCommand: "npm test",
      approvalMode: "manual",
      quality: {
        minStepScore: 0.2,
        minFinalConfidence: 0,
        requireEvidenceBeforeFinal: true,
        requireTestsPassed: true,
        requireTypecheckPassed: false
      },
      governance: {
        escalateHighRisk: true,
        recoverOnFailedStep: true,
        maxRecoveryAttempts: 3,
        maxFinalRejections: 2,
        maxConsecutiveFailedSteps: 3
      },
      security: {
        allowedTools: [
          "repo.list_files",
          "repo.search_code",
          "repo.read_file",
          "repo.apply_patch",
          "repo.run_tests",
          "repo.run_typecheck",
          "repo.git_diff"
        ],
        requireApprovalForMutations: true
      },
      evaluationCriteria: [
        {
          id: "tool_evidence",
          kind: "tool_evidence",
          description: "The loop gathered tool evidence before final completion.",
          required: true
        },
        {
          id: "tests_passed",
          kind: "tests_passed",
          description: "The latest configured test run passed.",
          required: true
        }
      ],
      budget: {
        maxIterations: 8,
        maxInvalidDecisions: 2,
        maxRepeatedActions: 3,
        maxEmptyRounds: 2,
        maxApproxTokens: 12000
      }
    });

    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, YAML.stringify(task), "utf8");
    console.log(`Created ${out}`);
  });

program
  .command("run")
  .description("Run an agent loop over a local workspace.")
  .option("--task <path>", "Task YAML file")
  .option("--goal <goal>", "Goal for the loop")
  .option("--workspace <path>", "Workspace path")
  .option("--skill <name>", "Skill name")
  .option("--model <name>", "Model adapter: mock or openai")
  .option("--test-command <command>", "Configured test command")
  .option("--typecheck-command <command>", "Optional configured typecheck command")
  .option("--auto-approve", "Approve mutating actions automatically")
  .option("--deny-approval", "Deny mutating actions automatically")
  .option("--max-iterations <count>", "Iteration budget")
  .option("--trace-db <path>", "SQLite trace database path")
  .option("--skills-dir <path>", "Skills directory")
  .action(async (options) => {
    const task = await loadTask(options);
    const result = await runAgentLoop(task, {
      skillsDir: resolve(options.skillsDir ?? "skills")
    });

    console.log(`Task ${result.taskId}: ${result.status}`);
    if (result.finalAnswer) {
      console.log(result.finalAnswer);
    }
    console.log(`Trace DB: ${result.traceDbPath}`);
  });

program
  .command("inspect")
  .description("Inspect task events from a trace database.")
  .requiredOption("--trace-db <path>", "SQLite trace database path")
  .option("--task-id <id>", "Task id to inspect")
  .action(async (options: { traceDb: string; taskId?: string }) => {
    const store = await SQLiteStateStore.open(resolve(options.traceDb));
    try {
      const taskIds = store.listTaskIds();
      const taskId = options.taskId ?? taskIds.at(-1);
      if (!taskId) {
        throw new Error("No tasks found in trace database.");
      }
      console.log(JSON.stringify(store.list(taskId), null, 2));
    } finally {
      store.close();
    }
  });

program
  .command("export-trace")
  .description("Export task events as JSON.")
  .requiredOption("--trace-db <path>", "SQLite trace database path")
  .option("--task-id <id>", "Task id to export")
  .requiredOption("--out <path>", "Output JSON path")
  .action(async (options: { traceDb: string; taskId?: string; out: string }) => {
    const store = await SQLiteStateStore.open(resolve(options.traceDb));
    try {
      const taskIds = store.listTaskIds();
      const taskId = options.taskId ?? taskIds.at(-1);
      if (!taskId) {
        throw new Error("No tasks found in trace database.");
      }
      const out = resolve(options.out);
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, JSON.stringify(store.list(taskId), null, 2), "utf8");
      console.log(`Exported ${out}`);
    } finally {
      store.close();
    }
  });

program
  .command("mcp-repo")
  .description("Start the repo MCP server over stdio.")
  .option("--workspace <path>", "Workspace path", ".")
  .option("--test-command <command>", "Configured test command", "npm test")
  .option("--typecheck-command <command>", "Optional configured typecheck command")
  .option("--allowed-tool <name...>", "Restrict MCP calls to allowed tool names")
  .option("--allow-mutations", "Allow direct MCP mutation tools such as repo.apply_patch")
  .action(
    async (options: {
      workspace: string;
      testCommand: string;
      typecheckCommand?: string;
      allowedTool?: string[];
      allowMutations?: boolean;
    }) => {
    await startRepoMcpServer(resolve(options.workspace), options.testCommand, options.typecheckCommand, {
      allowedTools: options.allowedTool,
      allowMutations: options.allowMutations === true
    });
  });

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function loadTask(options: Record<string, unknown>): Promise<TaskInput> {
  const yamlTask = typeof options.task === "string" ? await readYamlTask(resolve(options.task)) : {};
  const workspace = String(options.workspace ?? yamlTask.workspace ?? ".");
  const approvalMode = options.autoApprove ? "auto" : options.denyApproval ? "deny" : yamlTask.approvalMode;

  const candidate = {
    ...yamlTask,
    goal: options.goal ?? yamlTask.goal,
    workspace,
    skill: options.skill ?? yamlTask.skill,
    model: options.model ?? yamlTask.model,
    testCommand: options.testCommand ?? yamlTask.testCommand,
    typecheckCommand: options.typecheckCommand ?? yamlTask.typecheckCommand,
    approvalMode,
    traceDbPath: options.traceDb ?? yamlTask.traceDbPath,
    budget: {
      ...(typeof yamlTask.budget === "object" && yamlTask.budget ? yamlTask.budget : {}),
      maxIterations: options.maxIterations ?? (yamlTask.budget as { maxIterations?: unknown } | undefined)?.maxIterations
    }
  };

  return TaskInputSchema.parse(candidate);
}

async function readYamlTask(path: string): Promise<Record<string, unknown>> {
  if (!existsSync(path)) {
    throw new Error(`Task file not found: ${path}`);
  }
  const parsed = YAML.parse(await readFile(path, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Task file must contain a YAML object: ${path}`);
  }
  return parsed as Record<string, unknown>;
}
