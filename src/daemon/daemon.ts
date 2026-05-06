import { ERROR_CODES, ProtocolError } from "../proto/errors.js";
import { ensureStateDir, resolveStatePaths, type StatePaths } from "../state/paths.js";
import { isAlive, readPidFile, removePidFile, writePidFile } from "../state/pid.js";
import { readState, writeStateAtomic, type PersistedState } from "../state/state-file.js";
import { log, logError } from "../util/log.js";
import { buildHandlers } from "./handlers.js";
import { startSocketServer, type SocketServer } from "./socket-server.js";
import { DaemonState } from "./state.js";

function reapOrphans(persisted: PersistedState): void {
  const seen = new Set<number>();
  let killed = 0;
  for (const project of persisted.projects) {
    for (const src of project.sources) {
      const pid = src.pid;
      if (typeof pid !== "number" || pid <= 1 || seen.has(pid)) continue;
      seen.add(pid);
      // Try the whole process group first (sources are spawned with
      // `detached: true`, so pid == pgid). Fall back to the lone pid if the
      // group is already gone.
      try {
        process.kill(-pid, "SIGKILL");
        killed++;
      } catch {
        try {
          process.kill(pid, "SIGKILL");
          killed++;
        } catch {
          // already dead
        }
      }
    }
  }
  if (killed > 0) {
    log("reaped " + killed + " orphan worktree process group(s) from previous daemon");
  }
}

const VERSION = "0.0.1";

export interface RunDaemonOpts {
  paths?: StatePaths;
}

export async function runDaemon(opts: RunDaemonOpts = {}): Promise<void> {
  const paths = opts.paths ?? resolveStatePaths();
  await ensureStateDir(paths);

  const existingPid = await readPidFile(paths.pidPath);
  if (existingPid !== null && isAlive(existingPid)) {
    throw new ProtocolError(
      ERROR_CODES.ALREADY_RUNNING,
      "another hotcut daemon is running with pid " + existingPid,
    );
  }

  await writePidFile(paths.pidPath);

  const state = new DaemonState();

  const persisted = await readState(paths.stateFilePath).catch((err) => {
    logError("could not load state.json (continuing with empty state)", err);
    return { version: 1 as const, projects: [] };
  });
  if (persisted.projects.length > 0) {
    log(
      "loaded " +
        persisted.projects.length +
        " persisted project(s); will be re-registered on first command",
    );
  }

  // If a previous daemon died without running its shutdown handler, the
  // detached process groups it spawned are still alive — orphaned, holding
  // ports, and causing chaos for the new daemon. Kill them now before we
  // bind anything.
  reapOrphans(persisted);

  let socket: SocketServer | null = null;
  let shuttingDown = false;

  const persist = async (): Promise<void> => {
    // Once shutdown begins we delete state.json on disk. Any further persists
    // would race with that cleanup, fail with ENOENT on rename, and spam logs
    // forever if any source supervisor keeps emitting change events.
    if (shuttingDown) return;
    try {
      await writeStateAtomic(paths.stateFilePath, state.toPersisted());
    } catch (err) {
      logError("state persist failed", err);
    }
  };

  const requestShutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    void shutdown();
  };

  const handlers = buildHandlers({
    state,
    persist,
    requestShutdown,
    version: VERSION,
    logsDir: paths.logsDir,
  });
  socket = await startSocketServer(paths.sockPath, handlers);
  log("daemon listening on " + paths.sockPath + " (pid " + process.pid + ")");

  const shutdown = async (): Promise<void> => {
    state.shuttingDown = true;
    log("daemon shutting down");
    // Hard backstop: even if a project's shutdown hangs (a child process
    // ignoring SIGTERM, an fs op blocked, etc.) we must not leave an orphan
    // daemon. The CLI gives us 5s before giving up; budget a bit more here.
    const forceExit = setTimeout(() => {
      logError(
        "shutdown exceeded 8s — forcing exit",
        new Error("shutdown timeout"),
      );
      process.exit(1);
    }, 8000);
    forceExit.unref();
    if (socket) {
      await socket.close().catch(() => {});
      socket = null;
    }
    await Promise.all(
      [...state.projects.values()].map((p) => p.shutdown().catch(() => {})),
    );
    state.projects.clear();
    // Clean shutdown wipes persisted state. A crash leaves it behind so a
    // future restart could pick up where we left off (slice 4+ feature).
    const { unlink, rm } = await import("node:fs/promises");
    await Promise.all([
      removePidFile(paths.pidPath).catch(() => {}),
      unlink(paths.sockPath).catch(() => {}),
      unlink(paths.stateFilePath).catch(() => {}),
      rm(paths.logsDir, { recursive: true, force: true }).catch(() => {}),
    ]);
    process.exit(0);
  };

  const onSignal = (sig: NodeJS.Signals): void => {
    log("received " + sig);
    requestShutdown();
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));
}
