import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { resolveStatePaths } from "../state/paths.js";
import { startSocketServer, type SocketServer } from "./socket-server.js";
import { ensureDaemon, DaemonStartError } from "./auto-start.js";
import type { DaemonClient } from "./client.js";

let dir: string;
let server: SocketServer | null = null;
let client: DaemonClient | null = null;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hotcut-auto-"));
});

afterEach(async () => {
  client?.close();
  client = null;
  if (server) await server.close();
  server = null;
  await rm(dir, { recursive: true, force: true });
});

describe("ensureDaemon", () => {
  it("connects to an already-running daemon", async () => {
    const paths = resolveStatePaths({ HOTCUT_STATE_DIR: dir });
    server = await startSocketServer(paths.sockPath, {
      "daemon.status": async () => ({ pid: 1, uptime: 0, version: "x", projects: 0, sources: 0 }),
    });
    client = await ensureDaemon({ paths });
    const r = await client.request<{ version: string }>("daemon.status");
    assert.equal(r.version, "x");
  });

  it("forks the stub fork target when socket missing", async () => {
    const paths = resolveStatePaths({ HOTCUT_STATE_DIR: dir });
    const stub = join(dir, "stub.mjs");
    await writeFile(
      stub,
      [
        "import { createServer } from 'node:net';",
        "import { writeFile } from 'node:fs/promises';",
        "const sockPath = " + JSON.stringify(paths.sockPath) + ";",
        "const pidPath = " + JSON.stringify(paths.pidPath) + ";",
        "await writeFile(pidPath, String(process.pid), 'utf8');",
        "const srv = createServer((s) => { s.on('data', () => {}); });",
        "srv.listen(sockPath);",
        "setTimeout(() => { srv.close(); process.exit(0); }, 4000);",
      ].join("\n"),
      "utf8",
    );
    client = await ensureDaemon({ paths, forkTarget: stub, timeoutMs: 4000 });
    assert.ok(client);
  });

  it("fails with DaemonStartError if fork target never opens socket", async () => {
    const paths = resolveStatePaths({ HOTCUT_STATE_DIR: dir });
    const stub = join(dir, "stub.mjs");
    await writeFile(stub, "process.exit(0);\n", "utf8");
    await assert.rejects(
      () => ensureDaemon({ paths, forkTarget: stub, timeoutMs: 500, backoffMs: 50 }),
      (err: unknown) => err instanceof DaemonStartError,
    );
  });
});
