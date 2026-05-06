import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ProjectConfig } from "../config/schema.js";
import { findFreePort } from "../supervisor/port.js";
import { discoverSources } from "../discovery/discovery.js";
import { ProjectRuntime } from "./project-runtime.js";

const FIXTURE = `
const http = require("node:http");
const port = Number(process.env.HOTCUT_PORT);
const name = process.env.HOTCUT_NAME;
http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("hello from " + name);
}).listen(port);
`;

let dir: string;
let runtime: ProjectRuntime | null = null;

const PORT_RANGE_START = 47000 + Math.floor(Math.random() * 12000);

async function makeConfig(cmd = "node server.js") {
  const proxyPort = await findFreePort({ start: PORT_RANGE_START });
  return ProjectConfig.parse({
    project: { name: "p", proxy_port: proxyPort },
    run: {
      cmd,
      ready: { protocol: "http", endpoint: "/", timeout: "5s", poll_interval: "100ms" },
    },
  });
}

const SHARED_FIXTURE = `
process.stdout.write("shared up: " + process.env.HOTCUT_NAME + "\\n");
setInterval(() => {}, 1 << 30);
`;

async function makeConfigWithShared() {
  const proxyPort = await findFreePort({ start: PORT_RANGE_START });
  return ProjectConfig.parse({
    project: { name: "p", proxy_port: proxyPort },
    run: {
      cmd: "node server.js",
      ready: { protocol: "http", endpoint: "/", timeout: "5s", poll_interval: "100ms" },
    },
    shared: [
      { name: "tts", cmd: "node shared.js" },
    ],
  });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hotcut-rt-"));
  await mkdir(join(dir, ".worktree"));
  for (const name of ["A", "B"]) {
    await mkdir(join(dir, ".worktree", name));
    await writeFile(join(dir, ".worktree", name, "server.js"), FIXTURE);
  }
});

afterEach(async () => {
  if (runtime) await runtime.shutdown();
  runtime = null;
  await rm(dir, { recursive: true, force: true });
});

describe("ProjectRuntime", () => {
  it("registers sources and reports status", async () => {
    const config = await makeConfig();
    runtime = new ProjectRuntime({ root: dir, config, portRangeStart: PORT_RANGE_START });
    await runtime.start();
    const discovered = await discoverSources(dir, config);
    for (const d of discovered) await runtime.register(d);

    const t = runtime.status();
    assert.equal(t.sources.length, 2);
    assert.equal(t.sources.every((s) => s.state === "cold"), true);
    assert.equal(t.program, null);
  });

  it("up + cut + status + down round trip", async () => {
    const config = await makeConfig();
    runtime = new ProjectRuntime({ root: dir, config, portRangeStart: PORT_RANGE_START });
    await runtime.start();
    const discovered = await discoverSources(dir, config);
    for (const d of discovered) await runtime.register(d);

    const upRes = await runtime.up();
    assert.equal(upRes.failed.length, 0);
    assert.equal(upRes.started.length, 2);

    const cutRes = await runtime.cut("A");
    assert.equal(cutRes.program, "A");

    const t = runtime.status();
    assert.equal(t.program, "A");
    const a = t.sources.find((s) => s.name === "A")!;
    assert.equal(a.onProgram, true);
    assert.equal(a.state, "warm");

    const downRes = await runtime.down();
    assert.deepEqual(new Set(downRes.stopped), new Set(["A", "B"]));
  });

  it("auto-promotes the first source that warms to program", async () => {
    const config = await makeConfig();
    runtime = new ProjectRuntime({ root: dir, config, portRangeStart: PORT_RANGE_START });
    await runtime.start();
    const discovered = await discoverSources(dir, config);
    for (const d of discovered) await runtime.register(d);

    assert.equal(runtime.status().program, null);
    await runtime.up();

    const program = runtime.status().program;
    assert.ok(program === "A" || program === "B", "expected A or B, got " + program);
  });

  it("cut on missing source throws SOURCE_NOT_FOUND", async () => {
    const config = await makeConfig("true");
    runtime = new ProjectRuntime({ root: dir, config, portRangeStart: PORT_RANGE_START });
    await runtime.start();
    await assert.rejects(() => runtime!.cut("nope"), /source not found/);
  });

  it("starts shared services eagerly and exposes them in status", async () => {
    await writeFile(join(dir, "shared.js"), SHARED_FIXTURE);
    const config = await makeConfigWithShared();
    runtime = new ProjectRuntime({ root: dir, config, portRangeStart: PORT_RANGE_START });
    await runtime.start();

    // Eager start is fire-and-forget; for an always-ready service the
    // transition to warm happens synchronously after spawn. Wait briefly.
    await runtime.whenSharedSettled();
    const t = runtime.status();
    assert.equal(t.shared.length, 1);
    assert.equal(t.shared[0]!.name, "tts");
    assert.equal(t.shared[0]!.state, "warm");
  });

  it("up with no name includes shared services", async () => {
    await writeFile(join(dir, "shared.js"), SHARED_FIXTURE);
    const config = await makeConfigWithShared();
    runtime = new ProjectRuntime({ root: dir, config, portRangeStart: PORT_RANGE_START });
    await runtime.start();
    // Stop the eagerly-started shared service so up() actually has work to do.
    await runtime.down("tts");

    const discovered = await discoverSources(dir, config);
    for (const d of discovered) await runtime.register(d);

    const upRes = await runtime.up();
    assert.equal(upRes.failed.length, 0);
    // started includes both worktree sources and the shared service
    assert.ok(upRes.started.includes("tts"));
  });

  it("cut leaves shared services running", async () => {
    await writeFile(join(dir, "shared.js"), SHARED_FIXTURE);
    const config = await makeConfigWithShared();
    runtime = new ProjectRuntime({ root: dir, config, portRangeStart: PORT_RANGE_START });
    await runtime.start();
    const discovered = await discoverSources(dir, config);
    for (const d of discovered) await runtime.register(d);

    // Wait for shared to warm
    await runtime.whenSharedSettled();
    const sharedPidBefore = runtime.getShared("tts")!.pid;

    await runtime.up("A");
    await runtime.cut("A");

    const sharedAfter = runtime.status().shared[0]!;
    assert.equal(sharedAfter.state, "warm");
    assert.equal(runtime.getShared("tts")!.pid, sharedPidBefore);
  });

  it("logs handler resolves shared service names", async () => {
    await writeFile(join(dir, "shared.js"), SHARED_FIXTURE);
    const config = await makeConfigWithShared();
    runtime = new ProjectRuntime({ root: dir, config, portRangeStart: PORT_RANGE_START });
    await runtime.start();
    assert.ok(runtime.getShared("tts"));
    assert.equal(runtime.getSource("tts"), undefined);
  });

  it("rejects a worktree whose name collides with a shared service", async () => {
    await writeFile(join(dir, "shared.js"), SHARED_FIXTURE);
    const proxyPort = await findFreePort({ start: PORT_RANGE_START });
    const config = ProjectConfig.parse({
      project: { name: "p", proxy_port: proxyPort },
      run: {
        cmd: "node server.js",
        ready: { protocol: "http", endpoint: "/", timeout: "5s", poll_interval: "100ms" },
      },
      shared: [{ name: "A", cmd: "node shared.js" }], // collides with worktree A
    });
    runtime = new ProjectRuntime({ root: dir, config, portRangeStart: PORT_RANGE_START });
    await runtime.start();
    await assert.rejects(
      () => runtime!.register({ name: "A", worktreePath: join(dir, ".worktree", "A") }),
      /collides with a \[\[shared\]\] service/,
    );
  });

  it("shutdown stops shared services", async () => {
    await writeFile(join(dir, "shared.js"), SHARED_FIXTURE);
    const config = await makeConfigWithShared();
    runtime = new ProjectRuntime({ root: dir, config, portRangeStart: PORT_RANGE_START });
    await runtime.start();
    await runtime.whenSharedSettled();
    await runtime.shutdown();
    assert.equal(runtime.status().shared[0]!.state, "cold");
  });
});
