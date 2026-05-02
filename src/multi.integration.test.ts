import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { Bus } from "./bus/bus.js";
import { ProjectConfig } from "./config/schema.js";
import { discoverSources } from "./discovery/discovery.js";
import { startProxy, type ProxyServer } from "./proxy/server.js";
import { Supervisor } from "./supervisor/supervisor.js";

// Randomized port range start so concurrent test files don't collide.
const PORT_RANGE_START = 45000 + Math.floor(Math.random() * 15000);

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
let proxy: ProxyServer | null = null;
let supervisor: Supervisor | null = null;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hotcut-multi-"));
  await mkdir(join(dir, ".worktree"));
  for (const name of ["A", "B", "C"]) {
    await mkdir(join(dir, ".worktree", name));
    await writeFile(join(dir, ".worktree", name, "server.js"), FIXTURE);
  }
});

afterEach(async () => {
  if (supervisor) await supervisor.downAll();
  if (proxy) await proxy.close();
  supervisor = null;
  proxy = null;
  await rm(dir, { recursive: true, force: true });
});

describe("multi-source", () => {
  it("warms all and cuts between them", async () => {
    const config = ProjectConfig.parse({
      project: { name: "multi", proxy_port: 1 },
      run: {
        cmd: "node server.js",
        ready: { http: "/", timeout: "5s", poll_interval: "100ms" },
      },
    });

    const discovered = await discoverSources(dir, config);
    assert.equal(discovered.length, 3);

    supervisor = new Supervisor(config, { portRangeStart: PORT_RANGE_START });
    for (const d of discovered) await supervisor.register(d);

    const bus = new Bus();
    bus.cut(supervisor.list()[0]!);
    proxy = await startProxy(0, bus);
    const proxyPort = proxy.port;

    await supervisor.upAll();
    for (const s of supervisor.list()) assert.equal(s.state, "warm");

    // Default program is "A".
    let res = await fetch(`http://127.0.0.1:${proxyPort}/`);
    assert.equal(await res.text(), "hello from A");

    bus.cut(supervisor.get("B")!);
    res = await fetch(`http://127.0.0.1:${proxyPort}/`);
    assert.equal(await res.text(), "hello from B");

    bus.cut(supervisor.get("C")!);
    res = await fetch(`http://127.0.0.1:${proxyPort}/`);
    assert.equal(await res.text(), "hello from C");
  });

  it("each source gets a distinct port", async () => {
    const config = ProjectConfig.parse({
      project: { name: "multi", proxy_port: 1 },
      run: { cmd: "true" },
    });
    const discovered = await discoverSources(dir, config);
    supervisor = new Supervisor(config, { portRangeStart: PORT_RANGE_START });
    for (const d of discovered) await supervisor.register(d);

    const ports = new Set(supervisor.list().map((s) => s.port));
    assert.equal(ports.size, supervisor.list().length);
  });
});
