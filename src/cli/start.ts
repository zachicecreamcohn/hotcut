import { Command } from "commander";
import { Bus } from "../bus/bus.js";
import { findProjectRoot } from "../config/discover.js";
import { loadConfig } from "../config/load.js";
import { discoverSources } from "../discovery/discovery.js";
import { startProxy } from "../proxy/server.js";
import { Source } from "../supervisor/source.js";
import { Supervisor } from "../supervisor/supervisor.js";
import { log, logError } from "../util/log.js";
import { startKeypress } from "./keys.js";
import { TallyRenderer } from "./tally.js";

interface StartOptions {
  projectRoot?: string;
}

export function startCommand(): Command {
  return new Command("start")
    .description("Spawn every worktree's dev server and proxy to one (slice 2)")
    .option(
      "--project-root <path>",
      "override project root (default: nearest ancestor containing hotcut.toml)",
    )
    .action(async (opts: StartOptions) => {
      await runStart(opts);
    });
}

async function runStart(opts: StartOptions): Promise<void> {
  const projectRoot = opts.projectRoot
    ? opts.projectRoot
    : await findProjectRoot(process.cwd());
  const config = await loadConfig(projectRoot);

  const discovered = await discoverSources(projectRoot, config);
  if (discovered.length === 0) {
    throw new Error(
      `no worktrees found under ${projectRoot}/${config.project.worktree_root}`,
    );
  }

  const supervisor = new Supervisor(config, {
    reservedPorts: new Set([config.project.proxy_port]),
  });
  const bus = new Bus();
  const tally = new TallyRenderer({ projectName: config.project.name });

  for (const d of discovered) await supervisor.register(d);

  // Pick first source as initial program (will start serving once it warms).
  const first = supervisor.list()[0]!;
  bus.cut(first);

  const proxy = await startProxy(config.project.proxy_port, bus);
  log(`proxy on http://localhost:${config.project.proxy_port}`);

  const redraw = () => tally.render(supervisor.list(), bus);
  const offSupervisor = supervisor.onChange(redraw);
  const offBus = bus.onCut(redraw);
  redraw();

  const keys = startKeypress(async (key) => {
    if (key === "quit" || key === "q") {
      await shutdown();
      return;
    }
    const idx = parseInt(key, 10);
    if (Number.isInteger(idx) && idx >= 1 && idx <= supervisor.list().length) {
      const target = supervisor.list()[idx - 1]!;
      cutTo(target);
    }
  });

  const cutTo = (target: Source): void => {
    if (target.state === "cold" || target.state === "failed") {
      void target.up().catch((err) => logError(`up ${target.name} failed`, err));
    }
    bus.cut(target);
  };

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    keys.stop();
    offSupervisor();
    offBus();
    tally.clear();
    log("shutting down...");
    await proxy.close();
    await supervisor.downAll();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  keys.start();

  // Warm everything in parallel; failures are tracked in tally.
  void supervisor.upAll();
}
