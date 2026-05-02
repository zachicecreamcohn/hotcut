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

async function listen(port: number, status: number): Promise<void> {
  server = createServer((_req, res) => {
    res.writeHead(status);
    res.end();
  });
  await new Promise<void>((r) => server!.listen(port, "127.0.0.1", r));
}

function freePort(): number {
  // Random ephemeral port for tests.
  return 50000 + Math.floor(Math.random() * 10000);
}

describe("waitForHttpReady", () => {
  it("returns when server responds 2xx", async () => {
    const port = freePort();
    await listen(port, 200);
    await waitForHttpReady({
      port,
      path: "/",
      timeout: "1s",
      pollInterval: "50ms",
    });
  });

  it("treats 4xx as ready", async () => {
    const port = freePort();
    await listen(port, 404);
    await waitForHttpReady({
      port,
      path: "/",
      timeout: "1s",
      pollInterval: "50ms",
    });
  });

  it("times out when nothing is listening", async () => {
    await assert.rejects(
      waitForHttpReady({
        port: freePort(),
        path: "/",
        timeout: "200ms",
        pollInterval: "50ms",
      }),
      ReadyTimeoutError,
    );
  });

  it("aborts immediately when signal fires", async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort("test"), 50);
    await assert.rejects(
      waitForHttpReady({
        port: freePort(),
        path: "/",
        timeout: "10s",
        pollInterval: "50ms",
        signal: ac.signal,
      }),
      ReadyAbortedError,
    );
  });
});
