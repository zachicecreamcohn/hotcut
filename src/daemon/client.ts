import { connect, type Socket } from "node:net";
import { encodeMessage, MessageDecoder } from "../proto/framing.js";
import { ResponseEnvelope } from "../proto/schema.js";
import { ProtocolError, ERROR_CODES, type ErrorCode } from "../proto/errors.js";

let counter = 0;
function nextId(): string {
  counter += 1;
  return process.pid + "-" + Date.now() + "-" + counter;
}

interface StreamSink {
  push: (chunk: unknown) => void;
  finish: (err: Error | null) => void;
}

export class DaemonClient {
  private socket: Socket | null = null;
  private readonly decoder = new MessageDecoder();
  private readonly pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (err: Error) => void }
  >();
  private readonly streams = new Map<string, StreamSink>();
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
      const env = parsed.data;
      const stream = this.streams.get(env.id);
      if (stream) {
        if (env.error) {
          this.streams.delete(env.id);
          stream.finish(new ProtocolError(env.error.code as ErrorCode, env.error.message));
          continue;
        }
        if (env.done) {
          this.streams.delete(env.id);
          stream.finish(null);
          continue;
        }
        if (env.result !== undefined) stream.push(env.result);
        continue;
      }
      const p = this.pending.get(env.id);
      if (!p) continue;
      this.pending.delete(env.id);
      if (env.error) {
        p.reject(new ProtocolError(env.error.code as ErrorCode, env.error.message));
      } else {
        p.resolve(env.result);
      }
    }
  }

  private failAll(err: Error): void {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
    for (const s of this.streams.values()) s.finish(err);
    this.streams.clear();
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

  /**
   * Issue a streaming request. The returned async iterable yields each chunk
   * pushed by the daemon. When the daemon sends `done: true`, the iterable ends.
   * Call `cancel()` (returned alongside) to ask the daemon to stop streaming.
   */
  requestStream<T = unknown>(
    method: string,
    params?: unknown,
  ): { iterator: AsyncIterableIterator<T>; cancel: () => void } {
    if (!this.socket) throw new Error("not connected");
    const id = nextId();
    const queue: T[] = [];
    let resolveNext: ((v: IteratorResult<T>) => void) | null = null;
    let rejectNext: ((err: Error) => void) | null = null;
    let finished: { err: Error | null } | null = null;

    const sink: StreamSink = {
      push: (chunk) => {
        if (resolveNext) {
          const r = resolveNext;
          resolveNext = null;
          rejectNext = null;
          r({ value: chunk as T, done: false });
        } else {
          queue.push(chunk as T);
        }
      },
      finish: (err) => {
        finished = { err };
        if (resolveNext) {
          const rN = resolveNext;
          const rE = rejectNext;
          resolveNext = null;
          rejectNext = null;
          if (err) rE!(err);
          else rN({ value: undefined as never, done: true });
        }
      },
    };
    this.streams.set(id, sink);

    const wire = encodeMessage({ id, method, params });
    this.socket.write(wire);

    const iterator: AsyncIterableIterator<T> = {
      [Symbol.asyncIterator]() {
        return this;
      },
      next: () => {
        if (queue.length > 0) {
          return Promise.resolve({ value: queue.shift()!, done: false });
        }
        if (finished) {
          return finished.err
            ? Promise.reject(finished.err)
            : Promise.resolve({ value: undefined as never, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve, reject) => {
          resolveNext = resolve;
          rejectNext = reject;
        });
      },
      return: () => {
        cancel();
        return Promise.resolve({ value: undefined as never, done: true });
      },
    };

    const cancel = (): void => {
      if (finished) return;
      finished = { err: null };
      this.streams.delete(id);
      if (this.socket) {
        try {
          this.socket.write(encodeMessage({ id, method: "_cancel" }));
        } catch {
          // socket may have closed
        }
      }
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        rejectNext = null;
        r({ value: undefined as never, done: true });
      }
    };

    return { iterator, cancel };
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
