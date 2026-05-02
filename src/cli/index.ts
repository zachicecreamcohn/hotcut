#!/usr/bin/env node
import { Command } from "commander";
import { logError } from "../util/log.js";
import { runCut } from "./cmd-cut.js";
import { tallyCommand } from "./cmd-tally.js";
import { daemonCommand } from "./cmd-daemon.js";
import { logsCommand } from "./cmd-logs.js";
import { initCommand } from "./cmd-init.js";
import { stopCommand } from "./cmd-stop.js";
import { completionsCommand } from "./cmd-complete.js";

const KNOWN_VERBS = new Set([
  "completions",
  "init",
  "tally",
  "logs",
  "stop",
  "daemon",
  "help",
  "--help",
  "-h",
  "--version",
  "-V",
]);

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  // Verb resolver: if the first arg is not a known subcommand, treat as cut.
  if (argv.length >= 1 && argv[0] && !argv[0].startsWith("-") && !KNOWN_VERBS.has(argv[0])) {
    if (argv.length > 1) {
      logError("unexpected argument: " + argv[1]);
      process.exit(64);
    }
    await runCut(argv[0]);
    return;
  }

  const program = new Command();
  program
    .name("hotcut")
    .description("Cut to any worktree. Live.")
    .version("0.0.1");

  program.addCommand(initCommand());
  program.addCommand(tallyCommand());
  program.addCommand(logsCommand());
  program.addCommand(stopCommand());
  program.addCommand(daemonCommand());
  program.addCommand(completionsCommand());

  await program.parseAsync(process.argv);
}

main().catch((err: unknown) => {
  logError("fatal", err);
  process.exit(1);
});
