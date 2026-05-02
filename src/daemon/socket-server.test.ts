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
      ping: async (params) => ({ pong: params }),
    });
    client = new DaemonClient(sockPath);
    await client.connect();
    const result = await client.request<{ pong: { hi: number } }>("ping", { hi: 1 });
    assert.deepEqual(result, { pong: { hi: 1 } });
  });

  it("returns an error envelope for unknown methods", async () => {
    const sockPath = join(dir, "sock");
    server = await startSocketServer(sockPath, {});
    client = new DaemonClient(sockPath);
    await client.connect();
    await assert.rejects(
      () => client!.request("noSuchThing"),
      (err: unknown) =>
        err instanceof ProtocolError && err.code === ERROR_CODES.GENERIC,
    );
  });

  it("propagates ProtocolError code from handler", async () => {
    const sockPath = join(dir, "sock");
    server = await startSocketServer(sockPath, {
      boom: async () => {
        throw new ProtocolError(ERROR_CODES.SOURCE_NOT_FOUND, "missing");
      },
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
