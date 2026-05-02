import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ERROR_CODES, ProtocolError } from "../proto/errors.js";
import { DaemonClient } from "./client.js";
import { startSocketServer, type SocketServer } from "./socket-server.js";

let dir: string;
let server: SocketServer | null = null;
let client: DaemonClient | null = null;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hotcut-sock-"));
});

afterEach(async () => {
  client?.close();
  client = null;
  if (server) await server.close();
  server = null;
  await rm(dir, { recursive: true, force: true });
});

describe("socket server", () => {
  it("roundtrips a request and response", async () => {
    const sockPath = join(dir, "sock");
    server = await startSocketServer(sockPath, {
      unary: { ping: async (params: unknown) => ({ pong: params }) },
      stream: {},
    });
    client = new DaemonClient(sockPath);
    await client.connect();
    const result = await client.request<{ pong: { hi: number } }>("ping", { hi: 1 });
    assert.deepEqual(result, { pong: { hi: 1 } });
  });

  it("returns an error envelope for unknown methods", async () => {
    const sockPath = join(dir, "sock");
    server = await startSocketServer(sockPath, { unary: {}, stream: {} });
    client = new DaemonClient(sockPath);
    await client.connect();
    await assert.rejects(
      () => client!.request("noSuchThing"),
      (err: unknown) =>
        err instanceof ProtocolError && err.code === ERROR_CODES.GENERIC,
    );
  });

  it("streams chunks then ends with done", async () => {
    const sockPath = join(dir, "sock");
    server = await startSocketServer(sockPath, {
      unary: {},
      stream: {
        count: async (params: unknown, ctl) => {
          const n = (params as { n: number }).n;
          for (let i = 0; i < n; i++) {
            if (ctl.isCancelled()) return;
            ctl.push({ i });
          }
        },
      },
    });
    client = new DaemonClient(sockPath);
    await client.connect();
    const s = client.requestStream<{ i: number }>("count", { n: 3 });
    const out: number[] = [];
    for await (const chunk of s.iterator) out.push(chunk.i);
    assert.deepEqual(out, [0, 1, 2]);
  });

  it("supports stream cancellation", async () => {
    const sockPath = join(dir, "sock");
    server = await startSocketServer(sockPath, {
      unary: {},
      stream: {
        forever: async (_params: unknown, ctl) => {
          let cancelled = false;
          ctl.onCancel(() => {
            cancelled = true;
          });
          while (!cancelled) {
            ctl.push({ tick: Date.now() });
            await new Promise((r) => setTimeout(r, 10));
          }
        },
      },
    });
    client = new DaemonClient(sockPath);
    await client.connect();
    const s = client.requestStream<{ tick: number }>("forever");
    let received = 0;
    setTimeout(() => s.cancel(), 30);
    for await (const _ of s.iterator) {
      received += 1;
      if (received > 200) break;
    }
    assert.ok(received > 0);
  });

  it("propagates ProtocolError code from handler", async () => {
    const sockPath = join(dir, "sock");
    server = await startSocketServer(sockPath, {
      unary: {
        boom: async () => {
          throw new ProtocolError(ERROR_CODES.SOURCE_NOT_FOUND, "missing");
        },
      },
      stream: {},
    });
    client = new DaemonClient(sockPath);
    await client.connect();
    await assert.rejects(
      () => client!.request("boom"),
      (err: unknown) =>
        err instanceof ProtocolError &&
        err.code === ERROR_CODES.SOURCE_NOT_FOUND &&
        err.message === "missing",
    );
  });
});
