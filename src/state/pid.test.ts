import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { isAlive, readPidFile, removePidFile, writePidFile } from "./pid.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hotcut-pid-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("pid", () => {
  it("write/read roundtrip", async () => {
    const path = join(dir, "daemon.pid");
    await writePidFile(path, 12345);
    const back = await readPidFile(path);
    assert.equal(back, 12345);
  });

  it("readPidFile returns null when missing", async () => {
    const back = await readPidFile(join(dir, "nope.pid"));
    assert.equal(back, null);
  });

  it("isAlive true for current process", () => {
    assert.equal(isAlive(process.pid), true);
  });

  it("isAlive false for an unused pid", () => {
    assert.equal(isAlive(2 ** 22 - 1), false);
  });

  it("removePidFile is idempotent", async () => {
    const path = join(dir, "daemon.pid");
    await removePidFile(path);
    await writePidFile(path);
    await removePidFile(path);
    assert.equal(await readPidFile(path), null);
  });
});
