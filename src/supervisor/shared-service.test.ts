import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ProjectConfig } from "../config/schema.js";
import { findFreePort } from "./port.js";
import { SharedService } from "./shared-service.js";

const HTTP_FIXTURE = `
const http = require("node:http");
const port = Number(process.env.PORT);
http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("shared on " + port);
}).listen(port);
`;

const SLEEP_FIXTURE = `
process.stdout.write("worker started: " + process.env.HOTCUT_SCOPE + "\\n");
setInterval(() => {}, 1 << 30);
`;

let dir: string;
let svc: SharedService | null = null;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hotcut-shared-test-"));
});

afterEach(async () => {
  if (svc) await svc.down();
  svc = null;
  await rm(dir, { recursive: true, force: true });
});

function buildConfig(shared: unknown): ProjectConfig {
  return ProjectConfig.parse({
    project: { name: "test", proxy_port: 1 },
    run: { cmd: "true" },
    shared: [shared],
  });
}

describe("SharedService", () => {
  it("spawns with PORT env, becomes warm via http readiness, and tears down", async () => {
    await writeFile(join(dir, "server.js"), HTTP_FIXTURE);
    const port = await findFreePort();
    const projectConfig = buildConfig({
      name: "tts",
      cmd: "node server.js",
      port,
      ready: { http: "/", timeout: "5s", poll_interval: "100ms" },
    });
    const sharedCfg = projectConfig.shared[0]!;

    svc = new SharedService({
      config: sharedCfg,
      projectRoot: dir,
      projectConfig,
    });

    await svc.up();
    assert.equal(svc.state, "warm");
    assert.equal(svc.port, port);

    const res = await fetch("http://127.0.0.1:" + port + "/");
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, new RegExp("shared on " + port));

    await svc.down();
    assert.equal(svc.state, "cold");
  });

  it("supports always-ready services with no port", async () => {
    await writeFile(join(dir, "worker.js"), SLEEP_FIXTURE);
    const projectConfig = buildConfig({
      name: "worker",
      cmd: "node worker.js",
    });
    const sharedCfg = projectConfig.shared[0]!;

    svc = new SharedService({
      config: sharedCfg,
      projectRoot: dir,
      projectConfig,
    });

    await svc.up();
    assert.equal(svc.state, "warm");
    assert.equal(svc.port, null);

    await svc.down();
    assert.equal(svc.state, "cold");
  });

  it("uses cwd resolved against project root", async () => {
    await writeFile(join(dir, "worker.js"), SLEEP_FIXTURE);
    const projectConfig = buildConfig({
      name: "worker",
      cmd: "node worker.js",
      cwd: ".",
    });
    const sharedCfg = projectConfig.shared[0]!;

    svc = new SharedService({
      config: sharedCfg,
      projectRoot: dir,
      projectConfig,
    });
    assert.equal(svc.cwd, dir);
  });
});
