import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { toMs } from "../config/duration.js";

export type ReadyProtocol = "http" | "https";

export class ReadyTimeoutError extends Error {
  constructor(
    readonly url: string,
    readonly timeout: string,
  ) {
    super(`${url} not ready within ${timeout}`);
    this.name = "ReadyTimeoutError";
  }
}

export class ReadyAbortedError extends Error {
  constructor(readonly reason: string) {
    super(`ready check aborted: ${reason}`);
    this.name = "ReadyAbortedError";
  }
}

export interface ReadyCheckOpts {
  protocol?: ReadyProtocol;
  port: number;
  path: string;
  timeout: string;
  pollInterval: string;
  signal?: AbortSignal;
}

export async function waitForHttpReady(opts: ReadyCheckOpts): Promise<void> {
  const { port, path, signal } = opts;
  const protocol: ReadyProtocol = opts.protocol ?? "http";
  const timeoutMs = toMs(opts.timeout);
  const intervalMs = toMs(opts.pollInterval);
  const deadline = Date.now() + timeoutMs;
  const url = `${protocol}://127.0.0.1:${port}${path}`;

  while (true) {
    throwIfAborted(signal);
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    const probeStart = Date.now();
    if (await probe(protocol, port, path, Math.min(intervalMs, remaining), signal)) return;

    const elapsed = Date.now() - probeStart;
    const sleepFor = Math.max(0, intervalMs - elapsed);
    if (sleepFor > 0) await sleep(sleepFor, signal);
  }
  throw new ReadyTimeoutError(url, opts.timeout);
}

function probe(
  protocol: ReadyProtocol,
  port: number,
  path: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      req.destroy();
      reject(new ReadyAbortedError(signal!.reason?.toString() ?? "aborted"));
    };

    // For https on localhost, accept self-signed certs — readiness probes
    // should not be gated on cert validity for a process we just spawned
    // ourselves on 127.0.0.1.
    const requester = protocol === "https" ? httpsRequest : httpRequest;
    const req = requester(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "GET",
        timeout: timeoutMs,
        rejectUnauthorized: false,
      },
      (res: IncomingMessage) => {
        res.resume();
        const status = res.statusCode ?? 0;
        signal?.removeEventListener("abort", onAbort);
        resolve(status >= 200 && status < 500);
      },
    );
    req.on("error", () => {
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) {
        reject(new ReadyAbortedError(signal.reason?.toString() ?? "aborted"));
        return;
      }
      resolve(false);
    });
    req.on("timeout", () => {
      req.destroy();
    });
    if (signal) {
      if (signal.aborted) {
        req.destroy();
        reject(new ReadyAbortedError(signal.reason?.toString() ?? "aborted"));
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
    req.end();
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new ReadyAbortedError(signal.reason?.toString() ?? "aborted");
  }
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ReadyAbortedError(signal.reason?.toString() ?? "aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ReadyAbortedError(signal!.reason?.toString() ?? "aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
