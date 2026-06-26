#!/usr/bin/env node
import { Command } from "commander";
import { registerServiceCommands } from "./service-commands.js";
import { registerTaskCommands } from "./task-commands.js";

const program = new Command();

program.name("forloop").description("Model-agnostic agent loop runtime with MCP repo tools.").version("0.1.9");

registerTaskCommands(program);
registerServiceCommands(program);

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
