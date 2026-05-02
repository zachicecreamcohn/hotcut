#!/usr/bin/env node
import { Command } from "commander";
import { logError } from "../util/log.js";
import { runCut } from "./cmd-cut.js";
import { tallyCommand } from "./cmd-tally.js";
import { upCommand } from "./cmd-up.js";
import { downCommand } from "./cmd-down.js";
import { daemonCommand } from "./cmd-daemon.js";

const KNOWN_VERBS = new Set([
  "tally",
  "up",
  "down",
  "daemon",
  "version",
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
    const name = argv[0];
    const rest = argv.slice(1);
    let json = false;
    let wait: boolean | undefined;
    for (const a of rest) {
      if (a === "--json") json = true;
      else if (a === "--no-wait") wait = false;
      else if (a === "--wait") wait = true;
      else {
        logError("unknown flag: " + a);
        process.exit(64);
      }
    }
    await runCut(name, { json, wait });
    return;
  }

  const program = new Command();
  program
    .name("hotcut")
    .description("Cut to any worktree. Live.")
    .version("0.0.1");

  program.addCommand(tallyCommand());
  program.addCommand(upCommand());
  program.addCommand(downCommand());
  program.addCommand(daemonCommand());

  await program.parseAsync(process.argv);
}

main().catch((err: unknown) => {
  logError("fatal", err);
  process.exit(1);
});
