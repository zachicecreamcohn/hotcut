import { chmod, unlink } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { ERROR_CODES, ProtocolError } from "../proto/errors.js";
import { encodeMessage, MessageDecoder } from "../proto/framing.js";
import { RequestEnvelope, ResponseEnvelope } from "../proto/schema.js";
import { logError } from "../util/log.js";
import type { MethodHandler, StreamMethodHandler } from "./handlers.js";

export interface SocketServer {
  server: Server;
  close: () => Promise<void>;
}

export interface SocketHandlers {
  unary: Record<string, MethodHandler>;
  stream: Record<string, StreamMethodHandler>;
}

export async function startSocketServer(
  sockPath: string,
  handlers: SocketHandlers,
): Promise<SocketServer> {
  await unlink(sockPath).catch((err) => {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  });

  const server = createServer((socket) => handleConnection(socket, handlers));

  server.on("error", (err) => logError("socket server error", err));

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(sockPath, () => {
      server.off("error", reject);
      resolve();
    });
  });

  await chmod(sockPath, 0o600);

  return {
    server,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

function handleConnection(
  socket: Socket,
  handlers: SocketHandlers,
): void {
  const cancellers = new Map<string, () => void>();

  socket.on("close", () => {
    for (const c of cancellers.values()) {
      try {
        c();
      } catch {
        // ignore
      }
    }
    cancellers.clear();
  });

  const decoder = new MessageDecoder();

  socket.on("data", (chunk: Buffer) => {
    let messages: unknown[];
    try {
      messages = decoder.push(chunk);
    } catch (err) {
      logError("framing error on socket", err);
      socket.destroy();
      return;
    }
    for (const m of messages) {
      void dispatch(socket, handlers, cancellers, m);
    }
  });

  socket.on("error", () => {});
}

async function dispatch(
  socket: Socket,
  handlers: SocketHandlers,
  cancellers: Map<string, () => void>,
  raw: unknown,
): Promise<void> {
  const parsed = RequestEnvelope.safeParse(raw);
  if (!parsed.success) {
    writeResponse(socket, {
      id: extractId(raw),
      error: { code: ERROR_CODES.GENERIC, message: "invalid request envelope" },
    });
    return;
  }
  const req = parsed.data;

  // Special: client cancels a streaming request by sending the same id with method "_cancel".
  if (req.method === "_cancel") {
    const cancel = cancellers.get(req.id);
    if (cancel) {
      cancellers.delete(req.id);
      cancel();
    }
    return;
  }

  const stream = handlers.stream[req.method];
  if (stream) {
    let cancelled = false;
    const cancel = (): void => {
      cancelled = true;
    };
    cancellers.set(req.id, cancel);
    try {
      await stream(req.params, {
        push: (chunk) => {
          if (cancelled) return;
          writeResponse(socket, { id: req.id, result: chunk });
        },
        isCancelled: () => cancelled,
        onCancel: (fn) => {
          const wrapped = (): void => {
            cancelled = true;
            try {
              fn();
            } catch {
              // ignore
            }
          };
          cancellers.set(req.id, wrapped);
        },
      });
      writeResponse(socket, { id: req.id, done: true });
    } catch (err) {
      writeStreamError(socket, req.id, err);
    } finally {
      cancellers.delete(req.id);
    }
    return;
  }

  const handler = handlers.unary[req.method];
  if (!handler) {
    writeResponse(socket, {
      id: req.id,
      error: { code: ERROR_CODES.GENERIC, message: "unknown method: " + req.method },
    });
    return;
  }
  try {
    const result = await handler(req.params);
    writeResponse(socket, { id: req.id, result });
  } catch (err) {
    writeStreamError(socket, req.id, err);
  }
}

function writeStreamError(socket: Socket, id: string, err: unknown): void {
  if (err instanceof ProtocolError) {
    writeResponse(socket, {
      id,
      error: { code: err.code, message: err.message },
    });
  } else {
    writeResponse(socket, {
      id,
      error: {
        code: ERROR_CODES.GENERIC,
        message: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

function writeResponse(socket: Socket, response: ResponseEnvelope): void {
  if (socket.destroyed) return;
  try {
    socket.write(encodeMessage(response));
  } catch (err) {
    logError("write response failed", err);
  }
}

function extractId(raw: unknown): string {
  if (
    typeof raw === "object" &&
    raw !== null &&
    "id" in raw &&
    typeof (raw as { id: unknown }).id === "string"
  ) {
    return (raw as { id: string }).id;
  }
  return "unknown";
}
