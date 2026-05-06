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
console.log("starting " + name + " on " + port);
http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("hello from " + name);
}).listen(port, () => console.log("listening " + name));
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
    // Fake a git worktree pointer so discovery's requireGit check passes.
    await writeFile(
      join(project, ".worktree", name, ".git"),
      "gitdir: /nonexistent/.git/worktrees/" + name + "\n",
    );
  }
  const toml = [
    "[project]",
    'name = "p"',
    "proxy_port = " + proxyPort,
    "",
    "[run]",
    'cmd = "node server.js"',
    'ready = { protocol = "http", endpoint = "/", timeout = "5s", poll_interval = "100ms" }',
    "",
  ].join("\n");
  await writeFile(join(project, "hotcut.toml"), toml);
});

afterEach(async () => {
  try {
    await runCli(["stop"]);
  } catch {
    // already stopped
  }
  await rm(project, { recursive: true, force: true });
  await rm(stateDir, { recursive: true, force: true });
});

describe("cli integration", () => {
  it("auto-starts daemon, runs status, cuts to warm sources, and stops", async () => {
    // status no longer auto-spawns the daemon: it should report "not running".
    const status1 = await runCli(["status"]);
    assert.match(status1.stderr, /daemon not running/);

    await runCli(["A"]);
    const r1 = await fetch("http://127.0.0.1:" + proxyPort + "/");
    assert.equal(await r1.text(), "hello from A");

    await runCli(["B"]);
    const r2 = await fetch("http://127.0.0.1:" + proxyPort + "/");
    assert.equal(await r2.text(), "hello from B");

    const status2 = await runCli(["status", "--json"]);
    const status = JSON.parse(status2.stdout);
    assert.equal(status.projects.length, 1);
    const states = status.projects[0].sources.map((s: { state: string }) => s.state);
    assert.ok(states.includes("warm"));

    await runCli(["stop"]);

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

  it("hotcut logs returns recent stdout/stderr lines", async () => {
    await runCli(["A"]);
    // Give the fixture's startup chatter time to flush.
    await new Promise((r) => setTimeout(r, 200));
    const r = await runCli(["logs", "A", "--json"]);
    const lines = r.stdout.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    assert.ok(lines.length > 0, "expected at least one log line, got: " + r.stdout);
    for (const l of lines) {
      assert.ok(l.ts > 0);
      assert.ok(l.stream === "stdout" || l.stream === "stderr");
      assert.equal(typeof l.line, "string");
    }
  });

  it("hotcut <name> logs is equivalent to hotcut logs <name>", async () => {
    await runCli(["A"]);
    await new Promise((r) => setTimeout(r, 200));
    const r = await runCli(["A", "logs", "--json"]);
    const lines = r.stdout.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    assert.ok(lines.length > 0, "expected at least one log line, got: " + r.stdout);
    for (const l of lines) {
      assert.ok(l.ts > 0);
      assert.ok(l.stream === "stdout" || l.stream === "stderr");
      assert.equal(typeof l.line, "string");
    }
  });

  it("hotcut <name> up starts a single source", async () => {
    await runCli(["A", "up"]);
    const status = JSON.parse((await runCli(["status", "--json"])).stdout);
    const a = status.projects[0].sources.find((s: { name: string }) => s.name === "A");
    assert.equal(a.state, "warm");
    const b = status.projects[0].sources.find((s: { name: string }) => s.name === "B");
    assert.equal(b.state, "cold");
  });

  it("hotcut <name> down stops a single source", async () => {
    await runCli(["A", "up"]);
    await runCli(["A", "down"]);
    const status = JSON.parse((await runCli(["status", "--json"])).stdout);
    const a = status.projects[0].sources.find((s: { name: string }) => s.name === "A");
    assert.equal(a.state, "cold");
  });

  it("hotcut <worktree> <unknown> errors", async () => {
    await assert.rejects(
      runCli(["A", "bogus"]),
      (err: { stderr?: string; code?: number }) => {
        assert.match(err.stderr ?? "", /unknown subcommand for 'A': bogus/);
        return true;
      },
    );
  });

  it("auto-discovers new worktrees and removes deleted ones", async () => {
    // Need a registered project for the watcher to discover; warm-all does
    // both (auto-spawn daemon + register) without warming sources we don't
    // need here -- but we'd rather just `up` an existing source.
    await runCli(["A", "up"]);

    // Add a third worktree on the fly.
    const newWt = join(project, ".worktree", "C");
    await mkdir(newWt);
    await writeFile(join(newWt, ".git"), "gitdir: /x/.git/worktrees/C\n");

    await waitFor(async () => {
      const r = await runCli(["status", "--json"]);
      const t = JSON.parse(r.stdout);
      return t.projects[0].sources.find((s: { name: string }) => s.name === "C");
    });

    // Remove an existing one and verify it disappears.
    await rm(join(project, ".worktree", "A"), { recursive: true, force: true });
    await waitFor(async () => {
      const r = await runCli(["status", "--json"]);
      const t = JSON.parse(r.stdout);
      const found = t.projects[0].sources.find(
        (s: { name: string }) => s.name === "A",
      );
      return found ? undefined : true;
    });
  });
});

async function waitFor<T>(check: () => Promise<T | undefined>, timeoutMs = 5000): Promise<T> {
  const start = Date.now();
  while (true) {
    const r = await check();
    if (r !== undefined) return r as T;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((res) => setTimeout(res, 100));
  }
}
