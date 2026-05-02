#!/usr/bin/env node
import { Command } from "commander";
import { logError } from "../util/log.js";
import { startCommand } from "./start.js";

const program = new Command();
program
  .name("hotcut")
  .description("Cut to any worktree. Live.")
  .version("0.0.1");

program.addCommand(startCommand());

program.parseAsync().catch((err: unknown) => {
  logError("fatal", err);
  process.exit(1);
});
