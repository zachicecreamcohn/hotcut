import { spawn } from "node:child_process";
import { open } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { DaemonClient } from "./client.js";
import { ensureStateDir, resolveStatePaths, type StatePaths } from "../state/paths.js";
import { isAlive, readPidFile } from "../state/pid.js";

export interface EnsureDaemonOpts {
  paths?: StatePaths;
  forkTarget?: string;
  forkArgs?: string[];
  timeoutMs?: number;
  backoffMs?: number;
}

export class DaemonStartError extends Error {
  constructor(
    message: string,
    readonly logPath: string,
  ) {
    super(message);
    this.name = "DaemonStartError";
  }
}

export async function ensureDaemon(opts: EnsureDaemonOpts = {}): Promise<DaemonClient> {
  const paths = opts.paths ?? resolveStatePaths();
  await ensureStateDir(paths);

  const tryConnect = async (): Promise<DaemonClient | null> => {
    const c = new DaemonClient(paths.sockPath);
    try {
      await c.connect();
      return c;
    } catch {
      return null;
    }
  };

  const c = await tryConnect();
  if (c) return c;

  const livePid = await getLivePid(paths);
  if (livePid !== null) {
    const c2 = await waitForConnect(paths, opts.timeoutMs ?? 5000, opts.backoffMs ?? 100);
    if (c2) return c2;
    throw new DaemonStartError(
      "daemon pid " + livePid + " is alive but socket isn't accepting; check " + paths.daemonLogPath,
      paths.daemonLogPath,
    );
  }

  await forkDaemon(paths, opts);
  const c3 = await waitForConnect(paths, opts.timeoutMs ?? 5000, opts.backoffMs ?? 100);
  if (c3) return c3;
  throw new DaemonStartError(
    "daemon failed to start; see log: " + paths.daemonLogPath,
    paths.daemonLogPath,
  );
}

async function getLivePid(paths: StatePaths): Promise<number | null> {
  const pid = await readPidFile(paths.pidPath);
  if (pid === null) return null;
  return isAlive(pid) ? pid : null;
}

async function waitForConnect(
  paths: StatePaths,
  timeoutMs: number,
  backoffMs: number,
): Promise<DaemonClient | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const c = new DaemonClient(paths.sockPath);
    try {
      await c.connect();
      return c;
    } catch {
      await sleep(backoffMs);
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function forkDaemon(paths: StatePaths, opts: EnsureDaemonOpts): Promise<void> {
  const thisFile = fileURLToPath(import.meta.url);
  const here = dirname(thisFile);
  const isCompiled = thisFile.endsWith(".js");
  const defaultEntry = resolve(here, isCompiled ? "entry.js" : "entry.ts");
  const target = opts.forkTarget ?? defaultEntry;
  const useTsx = target.endsWith(".ts");

  const fh = await open(paths.daemonLogPath, "a", 0o600);
  const out = fh.createWriteStream({ autoClose: true });

  const cmd = useTsx
    ? resolve(here, "..", "..", "node_modules", ".bin", "tsx")
    : process.execPath;
  const args = useTsx ? [target, ...(opts.forkArgs ?? [])] : [target, ...(opts.forkArgs ?? [])];

  const child = spawn(cmd, args, {
    detached: true,
    stdio: ["ignore", out, out],
    env: process.env,
  });
  child.unref();

  // The child inherits its own dup'd fd; we no longer need the parent's.
  // End the stream (which closes the underlying FileHandle) so we don't leak it
  // to the GC and trigger DEP0137.
  out.end();
}
