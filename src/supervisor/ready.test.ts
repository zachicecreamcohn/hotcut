import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { afterEach, describe, it } from "node:test";
import {
  ReadyAbortedError,
  ReadyTimeoutError,
  waitForHttpReady,
} from "./ready.js";

let server: Server | null = null;

afterEach(async () => {
  if (server) {
    await new Promise<void>((r) => server!.close(() => r()));
    server = null;
  }
});

async function listen(status: number): Promise<number> {
  server = createServer((_req, res) => {
    res.writeHead(status);
    res.end();
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const addr = server!.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  return addr.port;
}

/**
 * Bind, capture the port, immediately release. Gives us a port that was
 * just confirmed unused. Still TOCTOU but good enough for this test.
 */
async function unboundPort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const addr = s.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  const port = addr.port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

describe("waitForHttpReady", () => {
  it("returns when server responds 2xx", async () => {
    const port = await listen(200);
    await waitForHttpReady({
      port,
      path: "/",
      timeout: "1s",
      pollInterval: "50ms",
    });
  });

  it("treats 4xx as ready", async () => {
    const port = await listen(404);
    await waitForHttpReady({
      port,
      path: "/",
      timeout: "1s",
      pollInterval: "50ms",
    });
  });

  it("times out when nothing is listening", async () => {
    const port = await unboundPort();
    await assert.rejects(
      waitForHttpReady({
        port,
        path: "/",
        timeout: "200ms",
        pollInterval: "50ms",
      }),
      ReadyTimeoutError,
    );
  });

  it("aborts immediately when signal fires", async () => {
    const port = await unboundPort();
    const ac = new AbortController();
    setTimeout(() => ac.abort("test"), 50);
    await assert.rejects(
      waitForHttpReady({
        port,
        path: "/",
        timeout: "10s",
        pollInterval: "50ms",
        signal: ac.signal,
      }),
      ReadyAbortedError,
    );
  });
});
