#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { logError } from "../util/log.js";
import { runCut } from "./cmd-cut.js";
import { runNameUp, runNameDown, runNameLogs } from "./cmd-name-verb.js";
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

  // Verb resolver. If the first arg is not a known top-level subcommand, treat
  // it as a name (worktree or shared service):
  //
  //   hotcut <name>            cut to it
  //   hotcut <name> up         start it
  //   hotcut <name> down       stop it
  //   hotcut <name> logs ...   tail its logs (rewritten into commander)
  if (argv.length >= 1 && argv[0] && !argv[0].startsWith("-") && !KNOWN_VERBS.has(argv[0])) {
    const name = argv[0];
    const sub = argv[1];
    if (sub === undefined) {
      await runCut(name);
      return;
    }
    if (sub === "up") {
      await runNameUp(name);
      return;
    }
    if (sub === "down") {
      await runNameDown(name);
      return;
    }
    if (sub === "logs") {
      const rest = argv.slice(2);
      const follow = rest.includes("-f") || rest.includes("--follow");
      const json = rest.includes("--json");
      await runNameLogs(name, { follow, json });
      return;
    }
    logError("unknown subcommand for '" + name + "': " + sub);
    process.exit(64);
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
