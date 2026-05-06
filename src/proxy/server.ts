import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { Socket } from "node:net";
import httpProxy from "http-proxy-3";
import type { Bus } from "../bus/bus.js";
import { log, logError } from "../util/log.js";

export interface ProxyServer {
  server: Server;
  port: number;
  close: () => Promise<void>;
}

export type ProxyProtocol = "http" | "https";

export async function startProxy(
  proxyPort: number,
  bus: Bus,
  protocol: ProxyProtocol = "http",
): Promise<ProxyServer> {
  const proxy = httpProxy.createProxyServer({
    ws: true,
    xfwd: true,
    secure: false,
  });

  proxy.on(
    "error",
    (err: Error, _req: IncomingMessage, res: ServerResponse | Socket) => {
      logError("upstream error", err);
      if ("writeHead" in res && !res.headersSent) {
        res.writeHead(502, { "content-type": "text/plain" });
        res.end(`hotcut proxy error: ${err.message}\n`);
      } else if ("destroy" in res) {
        res.destroy();
      }
    },
  );

  const server = createServer((req, res) => {
    const target = bus.programTarget();
    if (!target) {
      res.writeHead(503, { "content-type": "text/plain" });
      res.end("hotcut: no source on program\n");
      return;
    }
    proxy.web(req, res, { target: `${protocol}://127.0.0.1:${target.port}` });
  });

  server.on("upgrade", (req, socket, head) => {
    const target = bus.programTarget();
    if (!target) {
      socket.destroy();
      return;
    }
    proxy.ws(req, socket, head, { target: `${protocol}://127.0.0.1:${target.port}` });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(proxyPort, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const addr = server.address();
  const boundPort = addr && typeof addr !== "string" ? addr.port : proxyPort;
  log(`proxy listening on http://localhost:${boundPort}`);

  return {
    server,
    port: boundPort,
    close: () =>
      new Promise<void>((resolve) => {
        proxy.close();
        server.close(() => resolve());
      }),
  };
}
