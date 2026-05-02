import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ProjectConfig } from "../config/schema.js";
import type { DiscoveredSource } from "./discovery.js";
import { DiscoveryWatcher } from "./watcher.js";

let dir: string;
let watcher: DiscoveryWatcher | null = null;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hotcut-watcher-"));
  await mkdir(join(dir, ".worktree"));
});

afterEach(async () => {
  if (watcher) await watcher.stop();
  watcher = null;
  await rm(dir, { recursive: true, force: true });
});

function makeConfig(extra: object = {}) {
  return ProjectConfig.parse({
    project: { name: "p" },
    run: { cmd: "x" },
    ...extra,
  });
}

async function makeWorktree(name: string): Promise<void> {
  const path = join(dir, ".worktree", name);
  await mkdir(path);
  await writeFile(path + "/.git", "gitdir: /tmp/x/.git/worktrees/" + name + "\n");
}

function waitFor<T>(check: () => T | undefined, timeoutMs = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const r = check();
      if (r !== undefined) return resolve(r);
      if (Date.now() - start > timeoutMs) return reject(new Error("timeout"));
      setTimeout(tick, 25);
    };
    tick();
  });
}

describe("DiscoveryWatcher", () => {
  it("emits add when a new git worktree appears", async () => {
    const config = makeConfig();
    const added: DiscoveredSource[] = [];
    watcher = new DiscoveryWatcher(dir, config, {
      add: (s) => added.push(s),
      remove: () => {},
    });
    await watcher.start();

    await makeWorktree("PL-1");
    const result = await waitFor(() => added.find((s) => s.name === "PL-1"));
    assert.equal(result.name, "PL-1");
  });

  it("does not emit add for plain directories without .git", async () => {
    const config = makeConfig();
    const added: DiscoveredSource[] = [];
    watcher = new DiscoveryWatcher(dir, config, {
      add: (s) => added.push(s),
      remove: () => {},
    });
    await watcher.start();

    await mkdir(join(dir, ".worktree", "plain"));
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(added.length, 0);
  });

  it("emits remove when a worktree directory is deleted", async () => {
    await makeWorktree("PL-2");
    const config = makeConfig();
    const removed: string[] = [];
    watcher = new DiscoveryWatcher(dir, config, {
      add: () => {},
      remove: (name) => removed.push(name),
    });
    await watcher.start();

    await rm(join(dir, ".worktree", "PL-2"), { recursive: true, force: true });
    const result = await waitFor(() =>
      removed.includes("PL-2") ? "PL-2" : undefined,
    );
    assert.equal(result, "PL-2");
  });

  it("skips reserved CLI names", async () => {
    const config = makeConfig();
    const added: DiscoveredSource[] = [];
    watcher = new DiscoveryWatcher(dir, config, {
      add: (s) => added.push(s),
      remove: () => {},
    });
    await watcher.start();

    await makeWorktree("daemon");
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(added.length, 0);
  });

  it("respects discovery.exclude", async () => {
    const config = makeConfig({
      discovery: { include: ["*"], exclude: ["skip-me"] },
    });
    const added: DiscoveredSource[] = [];
    watcher = new DiscoveryWatcher(dir, config, {
      add: (s) => added.push(s),
      remove: () => {},
    });
    await watcher.start();

    await makeWorktree("skip-me");
    await makeWorktree("ok");
    await waitFor(() => added.find((s) => s.name === "ok"));
    assert.equal(added.find((s) => s.name === "skip-me"), undefined);
  });
});
