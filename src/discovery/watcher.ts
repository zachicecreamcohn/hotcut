import chokidar, { type FSWatcher } from "chokidar";
import { basename } from "node:path";
import type { ProjectConfig } from "../config/schema.js";
import { log } from "../util/log.js";
import {
  classifyName,
  isGitWorktree,
  RESERVED_NAMES,
  worktreeRootPath,
  type DiscoveredSource,
} from "./discovery.js";

const DEBOUNCE_MS = 200;

export interface WatcherEvents {
  add: (source: DiscoveredSource) => void;
  remove: (name: string) => void;
}

/**
 * Live watcher over `worktree_root`. Slice 4: depth=1, only emits for valid
 * git worktrees, debounced so a single `git worktree add` doesn't fire twice.
 *
 * `ignoreInitial: true` — callers handle initial population via discoverSources()
 * so the watcher only reports *changes* after that point.
 */
export class DiscoveryWatcher {
  private readonly projectRoot: string;
  private readonly config: ProjectConfig;
  private readonly listeners: WatcherEvents;
  private watcher: FSWatcher | null = null;
  private readonly pending = new Map<string, NodeJS.Timeout>();

  constructor(
    projectRoot: string,
    config: ProjectConfig,
    listeners: WatcherEvents,
  ) {
    this.projectRoot = projectRoot;
    this.config = config;
    this.listeners = listeners;
  }

  async start(): Promise<void> {
    if (this.watcher) return;
    const root = worktreeRootPath(this.projectRoot, this.config);
    this.watcher = chokidar.watch(root, {
      depth: 1,
      ignoreInitial: true,
      persistent: true,
      followSymlinks: false,
      awaitWriteFinish: false,
    });
    this.watcher.on("addDir", (path) => this.onAddDir(path));
    this.watcher.on("unlinkDir", (path) => this.onRemoveDir(path));
    await new Promise<void>((resolve) => {
      this.watcher!.once("ready", () => resolve());
    });
  }

  async stop(): Promise<void> {
    for (const t of this.pending.values()) clearTimeout(t);
    this.pending.clear();
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  private onAddDir(path: string): void {
    const root = worktreeRootPath(this.projectRoot, this.config);
    if (path === root) return;
    const name = basename(path);
    // Only react to direct children of worktree_root, not deeper.
    if (!isDirectChild(root, path)) return;

    const reason = classifyName(name, this.config);
    if (reason === "reserved") {
      log(
        `worktree '${name}' uses a reserved CLI name; skipping. ` +
          `(reserved: ${[...RESERVED_NAMES].join(", ")})`,
      );
      return;
    }
    if (reason !== null) return;

    this.schedule(name, async () => {
      if (!(await isGitWorktree(path))) return;
      this.listeners.add({ name, worktreePath: path });
    });
  }

  private onRemoveDir(path: string): void {
    const root = worktreeRootPath(this.projectRoot, this.config);
    if (!isDirectChild(root, path)) return;
    const name = basename(path);
    if (classifyName(name, this.config) !== null) return;
    this.schedule(name, () => {
      this.listeners.remove(name);
    });
  }

  private schedule(name: string, fn: () => void | Promise<void>): void {
    const existing = this.pending.get(name);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.pending.delete(name);
      void fn();
    }, DEBOUNCE_MS);
    timer.unref();
    this.pending.set(name, timer);
  }
}

function isDirectChild(root: string, path: string): boolean {
  if (!path.startsWith(root + "/") && !path.startsWith(root + "\\")) return false;
  const rest = path.slice(root.length + 1);
  return rest.length > 0 && !rest.includes("/") && !rest.includes("\\");
}
