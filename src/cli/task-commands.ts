import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Command } from "commander";
import YAML from "yaml";
import { loadForLoopConfig } from "../config/forloop-config.js";
import { createModelAdapterFromConfig } from "../models/provider-config.js";
import { runAgentLoop } from "../orchestrator/loop.js";
import { TaskInputSchema, type TaskInput } from "../orchestrator/schemas.js";
import { SQLiteStateStore } from "../storage/sqlite.js";
import { loadTask, stringOption } from "./options.js";

type RunCommandOptions = Readonly<Record<string, unknown>>;

export function registerTaskCommands(program: Command): void {
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
            "repo.git_diff",
            "memory.remember",
            "memory.search",
            "memory.list",
            "memory.delete",
            "shell.status",
            "shell.run"
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
    .option("--session-id <id>", "Stable session id used to isolate default trace storage")
    .option("--auto-approve", "Approve mutating actions automatically")
    .option("--deny-approval", "Deny mutating actions automatically")
    .option("--max-iterations <count>", "Iteration budget")
    .option("--trace-db <path>", "SQLite trace database base path; storage remains session-scoped")
    .option("--config <path>", "Optional ForLoop config YAML for provider and shell policy")
    .option("--skills-dir <path>", "Skills directory")
    .action(async (options: RunCommandOptions) => {
      const task = await loadTask(options);
      const config = await loadForLoopConfig({ workspace: task.workspace, configPath: stringOption(options.config) });
      const result = await runAgentLoop(task, {
        skillsDir: resolve(typeof options.skillsDir === "string" ? options.skillsDir : "skills"),
        model: config.provider ? createModelAdapterFromConfig(config.provider) : undefined,
        shellPolicy: config.shell
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
}
