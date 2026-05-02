import { strict as assert } from "node:assert";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { ensureStateDir, resolveStatePaths } from "./paths.js";

let dir: string | null = null;

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = null;
});

describe("state paths", () => {
  it("uses HOTCUT_STATE_DIR override", () => {
    const paths = resolveStatePaths({ HOTCUT_STATE_DIR: "/tmp/x" });
    assert.equal(paths.stateDir, "/tmp/x");
    assert.equal(paths.sockPath, "/tmp/x/sock");
    assert.equal(paths.pidPath, "/tmp/x/daemon.pid");
    assert.equal(paths.stateFilePath, "/tmp/x/state.json");
    assert.equal(paths.logsDir, "/tmp/x/logs");
  });

  it("falls back to ~/.local/state/hotcut without override", () => {
    const paths = resolveStatePaths({ HOME: "/tmp/fakehome" });
    assert.match(paths.stateDir, /\.local\/state\/hotcut$/);
  });

  it("ensureStateDir creates the directory tree with 0o700", async () => {
    dir = await mkdtemp(join(tmpdir(), "hotcut-paths-"));
    const paths = resolveStatePaths({ HOTCUT_STATE_DIR: join(dir, "state") });
    await ensureStateDir(paths);
    const s = await stat(paths.stateDir);
    assert.ok(s.isDirectory());
    assert.equal(s.mode & 0o777, 0o700);
    const ls = await stat(paths.logsDir);
    assert.ok(ls.isDirectory());
  });
});
