#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { logError } from "../util/log.js";
import { runCut } from "./cmd-cut.js";
import { statusCommand } from "./cmd-status.js";
import { warmAllCommand } from "./cmd-warm-all.js";
import { daemonCommand } from "./cmd-daemon.js";
import { logsCommand } from "./cmd-logs.js";
import { initCommand } from "./cmd-init.js";
import { stopCommand } from "./cmd-stop.js";
import { completionsCommand } from "./cmd-complete.js";

const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };

const KNOWN_VERBS = new Set([
  "completions",
  "warm-all",
  "init",
  "status",
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

  // Verb resolver: if the first arg is not a known subcommand, treat it as a
  // worktree name. Optional second arg is a per-worktree verb (e.g. "logs").
  if (argv.length >= 1 && argv[0] && !argv[0].startsWith("-") && !KNOWN_VERBS.has(argv[0])) {
    const name = argv[0];
    const sub = argv[1];
    if (sub === undefined) {
      await runCut(name);
      return;
    }
    if (sub === "logs") {
      // Rewrite argv so commander sees: `hotcut logs <name> [rest...]`
      process.argv = [process.argv[0]!, process.argv[1]!, "logs", name, ...argv.slice(2)];
    } else {
      logError("unknown subcommand for worktree '" + name + "': " + sub);
      process.exit(64);
    }
  }

  const program = new Command();
  program
    .name("hotcut")
    .description("Cut to any worktree. Live.")
    .version(pkg.version);

  program.addCommand(initCommand());
  program.addCommand(statusCommand());
  program.addCommand(warmAllCommand());
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
