import { createServer } from "node:net";
import { DEFAULTS } from "../config/defaults.js";

/**
 * Find an unused TCP port on 127.0.0.1.
 *
 * Caveat: there's an inherent TOCTOU race — by the time the caller binds
 * the returned port, another process could have grabbed it. Callers should
 * be prepared to retry on EADDRINUSE.
 *
 * Pass `exclude` to skip ports that have already been handed out in this
 * process (e.g. when allocating multiple ports in sequence before any of
 * them have been bound).
 */
export async function findFreePort(opts: {
  start?: number;
  end?: number;
  exclude?: ReadonlySet<number>;
} = {}): Promise<number> {
  const start = opts.start ?? DEFAULTS.ports.rangeStart;
  const end = opts.end ?? DEFAULTS.ports.rangeEnd;
  const exclude = opts.exclude ?? new Set();
  for (let port = start; port < end; port++) {
    if (exclude.has(port)) continue;
    if (await isFree(port)) return port;
  }
  throw new Error(`No free port in range ${start}-${end}`);
}

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}
