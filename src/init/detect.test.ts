import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { detectProject } from "./detect.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hotcut-init-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("detectProject", () => {
  it("uses npm run dev when package.json has a dev script", async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "myapp", scripts: { dev: "vite" } }),
    );
    const r = await detectProject(dir);
    assert.equal(r.cmd, "npm run dev");
    assert.equal(r.projectName, "myapp");
  });

  it("prefers dev over start", async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { dev: "vite", start: "node ." } }),
    );
    const r = await detectProject(dir);
    assert.equal(r.cmd, "npm run dev");
  });

  it("uses npm start when only start exists", async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { start: "node ." } }),
    );
    const r = await detectProject(dir);
    assert.equal(r.cmd, "npm start");
  });

  it("strips scope from package name", async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "@scope/thing", scripts: { dev: "x" } }),
    );
    const r = await detectProject(dir);
    assert.equal(r.projectName, "thing");
  });

  it("falls back to directory basename when no package name", async () => {
    const r = await detectProject(dir);
    assert.equal(r.projectName, dir.split("/").pop());
    assert.equal(r.cmd, "npm start");
  });

  it("detects .worktree directory", async () => {
    await mkdir(join(dir, ".worktree"));
    const r = await detectProject(dir);
    assert.equal(r.worktreeRoot, ".worktree");
    assert.ok(r.notes.some((n) => n.includes(".worktree/")));
  });

  it("returns a usable proxy port", async () => {
    const r = await detectProject(dir);
    assert.ok(r.proxyPort > 0);
    assert.ok(r.proxyPort < 65536);
  });
});
