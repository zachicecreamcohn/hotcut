import { findProjectRoot } from "../config/discover.js";
import { loadConfig } from "../config/load.js";
import type { ProjectConfig } from "../config/schema.js";
import { discoverSources } from "../discovery/discovery.js";
import { ensureDaemon, DaemonStartError } from "../daemon/auto-start.js";
import type { DaemonClient } from "../daemon/client.js";
import { ProtocolError, ERROR_CODES } from "../proto/errors.js";
import type { RegisterResult } from "../proto/schema.js";
import { logError } from "../util/log.js";

export interface ResolvedProject {
  root: string;
  config: ProjectConfig;
}

export async function resolveProject(): Promise<ResolvedProject> {
  let root: string;
  try {
    root = await findProjectRoot(process.cwd());
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
  let config: ProjectConfig;
  try {
    config = await loadConfig(root);
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
  return { root, config };
}

export async function connectDaemon(): Promise<DaemonClient> {
  try {
    return await ensureDaemon();
  } catch (err) {
    if (err instanceof DaemonStartError) {
      logError(err.message);
      process.exit(3);
    }
    logError("could not connect to daemon", err);
    process.exit(3);
  }
}

export async function registerProject(
  client: DaemonClient,
  project: ResolvedProject,
): Promise<RegisterResult> {
  const sources = await discoverSources(project.root, project.config);
  return client.request<RegisterResult>("register", {
    root: project.root,
    name: project.config.project.name,
    proxyPort: project.config.project.proxy_port,
    worktreeRoot: project.config.project.worktree_root,
    sources,
    configJson: JSON.stringify(project.config),
  });
}

export function exitForProtocolError(err: unknown): never {
  if (err instanceof ProtocolError) {
    logError(err.message);
    if (err.code === ERROR_CODES.SOURCE_NOT_FOUND) process.exit(4);
    if (err.code === ERROR_CODES.READY_TIMEOUT) process.exit(5);
    if (err.code === ERROR_CODES.CONFIG_INVALID) process.exit(2);
    process.exit(1);
  }
  logError(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
