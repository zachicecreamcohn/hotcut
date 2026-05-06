import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { Bus } from "./bus/bus.js";
import { ProjectConfig } from "./config/schema.js";
import { startProxy, type ProxyServer } from "./proxy/server.js";
import { findFreePort } from "./supervisor/port.js";
import { Source } from "./supervisor/source.js";

const FIXTURE = `
const http = require("node:http");
const port = Number(process.env.HOTCUT_PORT);
const name = process.env.HOTCUT_NAME;
http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("hello from " + name + " on " + port);
}).listen(port);
`;

let dir: string;
let source: Source | null = null;
let proxy: ProxyServer | null = null;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hotcut-test-"));
  await mkdir(join(dir, "wt"));
  await writeFile(join(dir, "wt", "server.js"), FIXTURE);
});

afterEach(async () => {
  if (source) await source.down();
  if (proxy) await proxy.close();
  source = null;
  proxy = null;
  await rm(dir, { recursive: true, force: true });
});

describe("end-to-end", () => {
  it("spawns a source, proxies to it, tears it down", async () => {
    const upstreamPort = await findFreePort();
    const config = ProjectConfig.parse({
      project: { name: "test", proxy_port: 1 },
      run: {
        cmd: "node server.js",
        ready: { protocol: "http", endpoint: "/", timeout: "5s", poll_interval: "100ms" },
      },
    });

    source = new Source({
      name: "wt",
      worktreePath: join(dir, "wt"),
      port: upstreamPort,
      config,
    });
    const bus = new Bus();
    bus.cut(source);
    proxy = await startProxy(0, bus);

    await source.up();
    assert.equal(source.state, "warm");

    const res = await fetch(`http://127.0.0.1:${proxy.port}/`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /hello from wt on \d+/);

    await source.down();
    assert.equal(source.state, "cold");
  });

  it("503s when nothing on program", async () => {
    const bus = new Bus();
    proxy = await startProxy(0, bus);
    const res = await fetch(`http://127.0.0.1:${proxy.port}/`);
    assert.equal(res.status, 503);
  });
});
