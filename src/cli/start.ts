import { stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { Command } from "commander";
import { Bus } from "../bus/bus.js";
import { findProjectRoot } from "../config/discover.js";
import { loadConfig } from "../config/load.js";
import { startProxy } from "../proxy/server.js";
import { findFreePort } from "../supervisor/port.js";
import { Source } from "../supervisor/source.js";
import { log, logError } from "../util/log.js";

interface StartOptions {
  projectRoot?: string;
}

export function startCommand(): Command {
  return new Command("start")
    .description("Start a single source and put it on program (slice 1)")
    .argument("[name]", "worktree name (e.g. PL-123) or path; defaults to $PWD")
    .option(
      "--project-root <path>",
      "override project root (default: nearest ancestor containing hotcut.toml)",
    )
    .action(async (name: string | undefined, opts: StartOptions) => {
      await runStart(name, opts);
    });
}

async function runStart(input: string | undefined, opts: StartOptions): Promise<void> {
  const projectRoot = opts.projectRoot
    ? resolve(opts.projectRoot)
    : await findProjectRoot(process.cwd());
  const config = await loadConfig(projectRoot);

  const worktreePath = input
    ? resolveWorktreePath(input, projectRoot, config.project.worktree_root)
    : worktreeFromCwd(process.cwd(), projectRoot, config.project.worktree_root);
  await assertDirectory(worktreePath, "worktree");
  const port = await findFreePort();
  const name = basename(worktreePath);

  const source = new Source({ name, worktreePath, port, config });
  const bus = new Bus();
  bus.setProgram(source);

  const proxy = startProxy(config.project.proxy_port, bus);

  installShutdown(async () => {
    log("shutting down...");
    await proxy.close();
    await source.down();
  });

  log(`spawning ${name} in ${worktreePath} on port ${port}`);
  try {
    await source.up();
    log(
      `${name} is warm; on program at http://localhost:${config.project.proxy_port}`,
    );
  } catch (err) {
    logError(`failed to start ${name}`, err);
    await proxy.close();
    await source.down();
    process.exit(1);
  }
}

function worktreeFromCwd(
  cwd: string,
  projectRoot: string,
  worktreeRoot: string,
): string {
  const root = resolve(projectRoot, worktreeRoot);
  const rel = relative(root, cwd);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(
      `cannot infer worktree from ${cwd}: not inside ${root}.\n` +
        `Pass a name explicitly, e.g. \`hotcut start PL-123\`.`,
    );
  }
  const [first] = rel.split(sep);
  if (!first) {
    throw new Error(
      `cannot infer worktree from ${cwd}: ${root} itself is not a worktree.\n` +
        `cd into a worktree directory or pass a name.`,
    );
  }
  return resolve(root, first);
}

function resolveWorktreePath(
  input: string,
  projectRoot: string,
  worktreeRoot: string,
): string {
  if (isAbsolute(input)) return input;
  // Bare name like "PL-123" → projectRoot/<worktree_root>/PL-123
  if (!input.includes("/")) {
    return resolve(projectRoot, worktreeRoot, input);
  }
  return resolve(projectRoot, input);
}

async function assertDirectory(path: string, label: string): Promise<void> {
  try {
    const s = await stat(path);
    if (!s.isDirectory()) {
      throw new Error(`${label} ${path} is not a directory`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`${label} not found: ${path}`);
    }
    throw err;
  }
}

function installShutdown(handler: () => Promise<void>): void {
  let running = false;
  const onSignal = (signal: string) => {
    if (running) return;
    running = true;
    log(`received ${signal}`);
    handler()
      .then(() => process.exit(0))
      .catch((err) => {
        logError("shutdown failed", err);
        process.exit(1);
      });
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));
}
