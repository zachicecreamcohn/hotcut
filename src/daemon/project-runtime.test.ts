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
      ready: { http: "/", timeout: "5s", poll_interval: "100ms" },
    },
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
  it("registers sources and reports tally", async () => {
    const config = await makeConfig();
    runtime = new ProjectRuntime({ root: dir, config, portRangeStart: PORT_RANGE_START });
    await runtime.start();
    const discovered = await discoverSources(dir, config);
    for (const d of discovered) await runtime.register(d);

    const t = runtime.tally();
    assert.equal(t.sources.length, 2);
    assert.equal(t.sources.every((s) => s.state === "cold"), true);
    assert.equal(t.program, null);
  });

  it("up + cut + tally + down round trip", async () => {
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

    const t = runtime.tally();
    assert.equal(t.program, "A");
    const a = t.sources.find((s) => s.name === "A")!;
    assert.equal(a.onProgram, true);
    assert.equal(a.state, "warm");

    const downRes = await runtime.down();
    assert.deepEqual(new Set(downRes.stopped), new Set(["A", "B"]));
  });

  it("cut on missing source throws SOURCE_NOT_FOUND", async () => {
    const config = await makeConfig("true");
    runtime = new ProjectRuntime({ root: dir, config, portRangeStart: PORT_RANGE_START });
    await runtime.start();
    await assert.rejects(() => runtime!.cut("nope"), /source not found/);
  });
});
