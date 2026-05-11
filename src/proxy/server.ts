import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";

type AnyServer = HttpServer | HttpsServer;
import { readFile } from "node:fs/promises";
import type { Socket } from "node:net";
import httpProxy from "http-proxy-3";
import type { Bus } from "../bus/bus.js";
import { log, logError } from "../util/log.js";

export interface ProxyServer {
  server: AnyServer;
  port: number;
  close: () => Promise<void>;
}

export type ProxyProtocol = "http" | "https";

export interface ProxyTlsOpts {
  cert: string;
  key: string;
}

export async function startProxy(
  proxyPort: number,
  bus: Bus,
  protocol: ProxyProtocol = "http",
  tls?: ProxyTlsOpts,
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

  const requestHandler = (req: IncomingMessage, res: ServerResponse) => {
    const target = bus.programTarget();
    if (!target) {
      res.writeHead(503, { "content-type": "text/plain" });
      res.end("hotcut: no source on program\n");
      return;
    }
    proxy.web(req, res, { target: `${protocol}://127.0.0.1:${target.port}` });
  };

  let server: AnyServer;
  if (protocol === "https") {
    if (!tls) throw new Error("https proxy requires tls cert and key");
    const [cert, key] = await Promise.all([
      readFile(tls.cert, "utf8"),
      readFile(tls.key, "utf8"),
    ]);
    server = createHttpsServer({ cert, key }, requestHandler);
  } else {
    server = createHttpServer(requestHandler);
  }

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
  log(`proxy listening on ${protocol}://localhost:${boundPort}`);

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
