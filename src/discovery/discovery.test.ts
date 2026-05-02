import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ProjectConfig } from "../config/schema.js";
import { discoverSources, isGitWorktree } from "./discovery.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hotcut-disc-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function configWith(overrides: object = {}) {
  return ProjectConfig.parse({
    project: { name: "p" },
    run: { cmd: "x" },
    ...overrides,
  });
}

async function makeWorktrees(names: string[]): Promise<void> {
  await mkdir(join(dir, ".worktree"));
  for (const n of names) await mkdir(join(dir, ".worktree", n));
}

describe("discoverSources", () => {
  it("returns empty when worktree_root does not exist", async () => {
    const result = await discoverSources(dir, configWith());
    assert.deepEqual(result, []);
  });

  it("lists subdirectories sorted by name", async () => {
    await makeWorktrees(["b", "a", "c"]);
    const result = await discoverSources(dir, configWith());
    assert.deepEqual(
      result.map((s) => s.name),
      ["a", "b", "c"],
    );
  });

  it("skips hidden, files, reserved names, and excluded names", async () => {
    await mkdir(join(dir, ".worktree"));
    await mkdir(join(dir, ".worktree", "PL-1"));
    await mkdir(join(dir, ".worktree", ".hidden"));
    await mkdir(join(dir, ".worktree", "tally"));   // reserved
    await mkdir(join(dir, ".worktree", "skip-me"));
    await writeFile(join(dir, ".worktree", "README.md"), "x");

    const config = configWith({
      discovery: { include: ["*"], exclude: ["skip-me"] },
    });
    const result = await discoverSources(dir, config);
    assert.deepEqual(
      result.map((s) => s.name),
      ["PL-1"],
    );
  });

  it("returns absolute worktreePath", async () => {
    await makeWorktrees(["a"]);
    const result = await discoverSources(dir, configWith());
    assert.equal(result[0]!.worktreePath, join(dir, ".worktree", "a"));
  });

  it("requireGit filters out plain directories", async () => {
    await makeWorktrees(["plain", "wt"]);
    await writeFile(
      join(dir, ".worktree", "wt", ".git"),
      "gitdir: /tmp/somewhere/.git/worktrees/wt\n",
    );
    const result = await discoverSources(dir, configWith(), { requireGit: true });
    assert.deepEqual(result.map((s) => s.name), ["wt"]);
  });
});

describe("isGitWorktree", () => {
  it("accepts a .git file with gitdir: pointer", async () => {
    const wt = join(dir, "ok");
    await mkdir(wt);
    await writeFile(join(wt, ".git"), "gitdir: /x/.git/worktrees/ok\n");
    assert.equal(await isGitWorktree(wt), true);
  });

  it("rejects when .git is a directory", async () => {
    const wt = join(dir, "repo");
    await mkdir(wt);
    await mkdir(join(wt, ".git"));
    assert.equal(await isGitWorktree(wt), false);
  });

  it("rejects plain directories with no .git", async () => {
    const wt = join(dir, "plain");
    await mkdir(wt);
    assert.equal(await isGitWorktree(wt), false);
  });

  it("rejects .git files without gitdir: prefix", async () => {
    const wt = join(dir, "weird");
    await mkdir(wt);
    await writeFile(join(wt, ".git"), "something else\n");
    assert.equal(await isGitWorktree(wt), false);
  });
});
