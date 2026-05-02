import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, it } from "node:test";
import { promisify } from "node:util";
import { findFreePort } from "./supervisor/port.js";

const exec = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ENTRY = resolve(HERE, "cli", "index.ts");
const TSX = resolve(HERE, "..", "node_modules", ".bin", "tsx");

const FIXTURE = `
const http = require("node:http");
const port = Number(process.env.HOTCUT_PORT);
const name = process.env.HOTCUT_NAME;
http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("hello from " + name);
}).listen(port);
`;

let project: string;
let stateDir: string;
let proxyPort: number;

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return exec(TSX, [CLI_ENTRY, ...args], {
    cwd: project,
    env: { ...process.env, HOTCUT_STATE_DIR: stateDir },
    timeout: 30_000,
  });
}

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), "hotcut-cli-"));
  stateDir = await mkdtemp(join(tmpdir(), "hotcut-cli-state-"));
  proxyPort = await findFreePort({ start: 49000 + Math.floor(Math.random() * 10000) });
  await mkdir(join(project, ".worktree"));
  for (const name of ["A", "B"]) {
    await mkdir(join(project, ".worktree", name));
    await writeFile(join(project, ".worktree", name, "server.js"), FIXTURE);
  }
  const toml = [
    "[project]",
    'name = "p"',
    "proxy_port = " + proxyPort,
    "",
    "[run]",
    'cmd = "node server.js"',
    'ready = { http = "/", timeout = "5s", poll_interval = "100ms" }',
    "",
  ].join("\n");
  await writeFile(join(project, "hotcut.toml"), toml);
});

afterEach(async () => {
  try {
    await runCli(["daemon", "stop"]);
  } catch {
    // already stopped
  }
  await rm(project, { recursive: true, force: true });
  await rm(stateDir, { recursive: true, force: true });
});

describe("cli integration", () => {
  it("auto-starts daemon, runs tally, up --all, cut, and stops", async () => {
    const tally1 = await runCli(["tally"]);
    assert.match(tally1.stderr, /\bp\b/);

    const upRes = await runCli(["up", "--all", "--json"]);
    const up = JSON.parse(upRes.stdout);
    assert.equal(up.failed.length, 0);

    const tally2 = await runCli(["tally", "--json"]);
    const tally = JSON.parse(tally2.stdout);
    assert.equal(tally.projects.length, 1);
    assert.equal(tally.projects[0].sources.every((s: { state: string }) => s.state === "warm"), true);

    await runCli(["A"]);
    const r1 = await fetch("http://127.0.0.1:" + proxyPort + "/");
    assert.equal(await r1.text(), "hello from A");

    await runCli(["B"]);
    const r2 = await fetch("http://127.0.0.1:" + proxyPort + "/");
    assert.equal(await r2.text(), "hello from B");

    await runCli(["daemon", "stop"]);

    let sockGone = false;
    let pidGone = false;
    try {
      await stat(join(stateDir, "sock"));
    } catch {
      sockGone = true;
    }
    try {
      await stat(join(stateDir, "daemon.pid"));
    } catch {
      pidGone = true;
    }
    assert.ok(sockGone, "sock should be removed");
    assert.ok(pidGone, "pid file should be removed");
  });
});
