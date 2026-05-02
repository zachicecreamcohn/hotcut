import { readFile, readdir, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { ProjectConfig } from "../config/schema.js";

export interface DiscoveredSource {
  name: string;
  worktreePath: string;
}

export const RESERVED_NAMES = new Set([
  "init",
  "status",
  "logs",
  "warm-all",
  "stop",
  "daemon",
]);

export function worktreeRootPath(
  projectRoot: string,
  config: ProjectConfig,
): string {
  return resolve(projectRoot, config.project.worktree_root);
}

/**
 * Decide whether a directory under `worktree_root` should be tracked.
 * Returns null when accepted; otherwise a reason to skip (for logging).
 */
export function classifyName(
  name: string,
  config: ProjectConfig,
): "hidden" | "reserved" | "excluded" | null {
  if (name.startsWith(".")) return "hidden";
  if (RESERVED_NAMES.has(name)) return "reserved";
  if (config.discovery.exclude.includes(name)) return "excluded";
  return null;
}

/**
 * A directory inside `worktree_root` is a real git worktree if it contains a
 * `.git` regular file whose first line begins with "gitdir: ". Returns false
 * for plain directories or anything else.
 */
export async function isGitWorktree(worktreePath: string): Promise<boolean> {
  try {
    const gitPath = resolve(worktreePath, ".git");
    const s = await stat(gitPath);
    if (!s.isFile()) return false;
    const head = (await readFile(gitPath, "utf8")).slice(0, 256);
    return head.trimStart().startsWith("gitdir:");
  } catch {
    return false;
  }
}

/**
 * One-shot listing of worktrees under `worktree_root`. Used at startup before
 * the live watcher takes over.
 *
 * Slice 4: if `requireGit` is true (the default for the daemon), only directories
 * with a valid `.git` pointer file are returned. Tests can pass false to use
 * plain directories as fixtures.
 */
export async function discoverSources(
  projectRoot: string,
  config: ProjectConfig,
  opts: { requireGit?: boolean } = {},
): Promise<DiscoveredSource[]> {
  const root = worktreeRootPath(projectRoot, config);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const requireGit = opts.requireGit ?? false;
  const sources: DiscoveredSource[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (classifyName(entry.name, config) !== null) continue;
    const worktreePath = resolve(root, entry.name);
    if (requireGit && !(await isGitWorktree(worktreePath))) continue;
    sources.push({ name: entry.name, worktreePath });
  }
  sources.sort((a, b) => a.name.localeCompare(b.name));
  return sources;
}

export function nameFromWorktreePath(path: string): string {
  return basename(path);
}
