import { toMs } from "../config/duration.js";

export class ReadyTimeoutError extends Error {
  constructor(
    readonly port: number,
    readonly path: string,
    readonly timeout: string,
  ) {
    super(`http://127.0.0.1:${port}${path} not ready within ${timeout}`);
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
  port: number;
  path: string;
  timeout: string;
  pollInterval: string;
  signal?: AbortSignal;
}

export async function waitForHttpReady(opts: ReadyCheckOpts): Promise<void> {
  const { port, path, signal } = opts;
  const timeoutMs = toMs(opts.timeout);
  const intervalMs = toMs(opts.pollInterval);
  const deadline = Date.now() + timeoutMs;
  const url = `http://127.0.0.1:${port}${path}`;

  while (true) {
    throwIfAborted(signal);
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    const probeStart = Date.now();
    if (await probe(url, Math.min(intervalMs, remaining), signal)) return;

    const elapsed = Date.now() - probeStart;
    const sleepFor = Math.max(0, intervalMs - elapsed);
    if (sleepFor > 0) await sleep(sleepFor, signal);
  }
  throw new ReadyTimeoutError(port, path, opts.timeout);
}

async function probe(
  url: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  const signals = [AbortSignal.timeout(timeoutMs)];
  if (signal) signals.push(signal);
  try {
    const res = await fetch(url, { signal: AbortSignal.any(signals) });
    return res.status >= 200 && res.status < 500;
  } catch {
    throwIfAborted(signal);
    return false;
  }
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
