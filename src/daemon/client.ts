import { connect, type Socket } from "node:net";
import { encodeMessage, MessageDecoder } from "../proto/framing.js";
import { ResponseEnvelope } from "../proto/schema.js";
import { ProtocolError, ERROR_CODES, type ErrorCode } from "../proto/errors.js";

let counter = 0;
function nextId(): string {
  counter += 1;
  return process.pid + "-" + Date.now() + "-" + counter;
}

export class DaemonClient {
  private socket: Socket | null = null;
  private readonly decoder = new MessageDecoder();
  private readonly pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (err: Error) => void }
  >();
  private connectError: Error | null = null;

  constructor(private readonly sockPath: string) {}

  async connect(): Promise<void> {
    if (this.socket) return;
    await new Promise<void>((resolve, reject) => {
      const s = connect(this.sockPath);
      s.once("error", (err) => {
        this.connectError = err;
        reject(err);
      });
      s.once("connect", () => {
        s.off("error", reject);
        this.socket = s;
        s.on("data", (chunk: Buffer) => this.onData(chunk));
        s.on("error", () => this.failAll(new Error("socket error")));
        s.on("close", () => this.failAll(new Error("socket closed")));
        resolve();
      });
    });
  }

  private onData(chunk: Buffer): void {
    let messages: unknown[];
    try {
      messages = this.decoder.push(chunk);
    } catch (err) {
      this.failAll(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    for (const m of messages) {
      const parsed = ResponseEnvelope.safeParse(m);
      if (!parsed.success) continue;
      const p = this.pending.get(parsed.data.id);
      if (!p) continue;
      this.pending.delete(parsed.data.id);
      if (parsed.data.error) {
        p.reject(
          new ProtocolError(
            parsed.data.error.code as ErrorCode,
            parsed.data.error.message,
          ),
        );
      } else {
        p.resolve(parsed.data.result);
      }
    }
  }

  private failAll(err: Error): void {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.socket) throw new Error("not connected");
    const id = nextId();
    const wire = encodeMessage({ id, method, params });
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
      });
      this.socket!.write(wire, (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  close(): void {
    this.socket?.end();
    this.socket = null;
    this.failAll(new Error("client closed"));
  }

  get lastConnectError(): Error | null {
    return this.connectError;
  }
}

export { ERROR_CODES };
