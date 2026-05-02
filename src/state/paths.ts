import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface StatePaths {
  stateDir: string;
  sockPath: string;
  pidPath: string;
  stateFilePath: string;
  daemonLogPath: string;
  logsDir: string;
}

export function resolveStatePaths(env: NodeJS.ProcessEnv = process.env): StatePaths {
  const override = env.HOTCUT_STATE_DIR;
  const stateDir = override
    ? resolve(override)
    : join(homedir(), ".local", "state", "hotcut");
  return {
    stateDir,
    sockPath: join(stateDir, "sock"),
    pidPath: join(stateDir, "daemon.pid"),
    stateFilePath: join(stateDir, "state.json"),
    daemonLogPath: join(stateDir, "daemon.log"),
    logsDir: join(stateDir, "logs"),
  };
}

export async function ensureStateDir(paths: StatePaths): Promise<void> {
  await mkdir(paths.stateDir, { recursive: true, mode: 0o700 });
  await mkdir(paths.logsDir, { recursive: true, mode: 0o700 });
}
