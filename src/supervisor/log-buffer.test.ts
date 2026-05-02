import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { LogBuffer } from "./log-buffer.js";

let dir: string;
let buf: LogBuffer | null = null;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hotcut-logbuf-"));
});

afterEach(async () => {
  if (buf) await buf.close();
  buf = null;
  await rm(dir, { recursive: true, force: true });
});

describe("LogBuffer", () => {
  it("recent() returns the last N appended entries in order", () => {
    buf = new LogBuffer({ bufferLines: 100 });
    for (let i = 0; i < 5; i++) buf.append("stdout", "line " + i);
    const all = buf.recent();
    assert.deepEqual(all.map((e) => e.line), ["line 0", "line 1", "line 2", "line 3", "line 4"]);
    const last2 = buf.recent(2);
    assert.deepEqual(last2.map((e) => e.line), ["line 3", "line 4"]);
  });

  it("ring overwrites oldest when capacity is exceeded", () => {
    buf = new LogBuffer({ bufferLines: 3 });
    for (let i = 0; i < 5; i++) buf.append("stdout", "line " + i);
    assert.deepEqual(
      buf.recent().map((e) => e.line),
      ["line 2", "line 3", "line 4"],
    );
  });

  it("subscribe receives new entries and unsubscribe stops them", () => {
    buf = new LogBuffer({ bufferLines: 10 });
    const seen: string[] = [];
    const off = buf.subscribe((e) => seen.push(e.line));
    buf.append("stdout", "a");
    buf.append("stderr", "b");
    off();
    buf.append("stdout", "c");
    assert.deepEqual(seen, ["a", "b"]);
  });

  it("writes to the configured file path", async () => {
    const filePath = join(dir, "src.log");
    buf = new LogBuffer({ bufferLines: 10, filePath });
    buf.append("stdout", "first");
    buf.append("stderr", "second");
    await buf.close();
    const text = await readFile(filePath, "utf8");
    assert.match(text, /stdout first/);
    assert.match(text, /stderr second/);
  });

  it("rotates when the file exceeds rotateBytes", async () => {
    const filePath = join(dir, "src.log");
    buf = new LogBuffer({
      bufferLines: 10,
      filePath,
      rotateBytes: 80,
      rotateKeep: 2,
    });
    for (let i = 0; i < 10; i++) buf.append("stdout", "line-" + i + "-padding");
    await buf.close();
    const main = await stat(filePath);
    assert.ok(main.size >= 0);
    // At least one rotated file should exist.
    const rotated = await stat(filePath + ".1").catch(() => null);
    assert.ok(rotated, "expected rotated file " + filePath + ".1");
  });
});
