import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { ProjectConfig } from "../config/schema.js";

export interface DiscoveredSource {
  name: string;
  worktreePath: string;
}

const RESERVED = new Set([
  "init",
  "tally",
  "up",
  "down",
  "logs",
  "daemon",
  "config",
  "version",
  "start",
]);

/**
 * List directories under <projectRoot>/<worktree_root>, returning each as a
 * candidate source. Skips hidden entries, reserved names, and anything in the
 * config's discovery.exclude list.
 *
 * Slice 2: no chokidar, no .git validity check (deferred to slice 4).
 * Slice 4 will replace this with a live watcher.
 */
export async function discoverSources(
  projectRoot: string,
  config: ProjectConfig,
): Promise<DiscoveredSource[]> {
  const root = resolve(projectRoot, config.project.worktree_root);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const exclude = new Set(config.discovery.exclude);
  const sources: DiscoveredSource[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    if (exclude.has(entry.name)) continue;
    if (RESERVED.has(entry.name)) continue;
    sources.push({
      name: entry.name,
      worktreePath: resolve(root, entry.name),
    });
  }
  sources.sort((a, b) => a.name.localeCompare(b.name));
  return sources;
}
