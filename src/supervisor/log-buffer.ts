import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { createWriteStream, type WriteStream } from "node:fs";
import { dirname } from "node:path";
import { logError } from "../util/log.js";

export type LogStream = "stdout" | "stderr";

export interface LogEntry {
  ts: number;
  stream: LogStream;
  line: string;
}

export type LogListener = (entry: LogEntry) => void;

export interface LogBufferOpts {
  bufferLines: number;
  rotateBytes?: number;
  rotateKeep?: number;
  filePath?: string;
}

const DEFAULT_ROTATE_BYTES = 10 * 1024 * 1024;
const DEFAULT_ROTATE_KEEP = 3;

/**
 * Per-source ring buffer of recent log lines plus an append-only file with
 * size-based rotation. Subscribers receive each new entry in real time
 * (used by `hotcut logs -f`).
 */
export class LogBuffer {
  private readonly entries: (LogEntry | undefined)[];
  private readonly capacity: number;
  private head = 0;
  private size = 0;
  private readonly listeners = new Set<LogListener>();

  private readonly filePath: string | null;
  private readonly rotateBytes: number;
  private readonly rotateKeep: number;
  private fileStream: WriteStream | null = null;
  private bytesWritten = 0;
  private fileReady: Promise<void> | null = null;
  private rotating = false;

  constructor(opts: LogBufferOpts) {
    this.capacity = Math.max(1, opts.bufferLines);
    this.entries = new Array(this.capacity);
    this.filePath = opts.filePath ?? null;
    this.rotateBytes = opts.rotateBytes ?? DEFAULT_ROTATE_BYTES;
    this.rotateKeep = opts.rotateKeep ?? DEFAULT_ROTATE_KEEP;
    if (this.filePath) {
      this.fileReady = this.openFile(this.filePath);
    }
  }

  append(stream: LogStream, line: string): void {
    const entry: LogEntry = { ts: Date.now(), stream, line };
    this.entries[this.head] = entry;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size += 1;
    this.writeToFile(entry);
    for (const l of this.listeners) {
      try {
        l(entry);
      } catch (err) {
        logError("log listener threw", err);
      }
    }
  }

  recent(n?: number): LogEntry[] {
    const count = n === undefined ? this.size : Math.min(n, this.size);
    const out: LogEntry[] = new Array(count);
    const start = (this.head - count + this.capacity) % this.capacity;
    for (let i = 0; i < count; i++) {
      out[i] = this.entries[(start + i) % this.capacity]!;
    }
    return out;
  }

  subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close(): Promise<void> {
    this.listeners.clear();
    if (this.fileReady) {
      await this.fileReady.catch(() => {});
      this.fileReady = null;
    }
    if (this.fileStream) {
      const stream = this.fileStream;
      this.fileStream = null;
      await new Promise<void>((resolve) => stream.end(resolve));
    }
  }

  private async openFile(filePath: string): Promise<void> {
    try {
      await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
      const existing = await stat(filePath).catch(() => null);
      this.bytesWritten = existing?.size ?? 0;
      this.fileStream = createWriteStream(filePath, { flags: "a", mode: 0o600 });
    } catch (err) {
      logError("failed to open log file " + filePath, err);
      this.fileStream = null;
    }
  }

  private writeToFile(entry: LogEntry): void {
    if (!this.filePath) return;
    const out = entry.ts + " " + entry.stream + " " + entry.line + "\n";
    const buf = Buffer.from(out, "utf8");
    const step = async (): Promise<void> => {
      if (!this.fileStream) return;
      if (this.bytesWritten + buf.length > this.rotateBytes) {
        await this.rotate();
      }
      if (!this.fileStream) return;
      this.fileStream.write(buf);
      this.bytesWritten += buf.length;
    };
    this.fileReady = (this.fileReady ?? Promise.resolve())
      .then(step)
      .catch((err) => {
        logError("log file write failed", err);
      });
  }

  private async rotate(): Promise<void> {
    if (!this.filePath || !this.fileStream || this.rotating) return;
    this.rotating = true;
    try {
      const stream = this.fileStream;
      this.fileStream = null;
      await new Promise<void>((resolve) => stream.end(resolve));

      // Shift: file.log.<keep-1> drops, .<n> -> .<n+1>, .log -> .log.1
      for (let i = this.rotateKeep - 1; i >= 1; i--) {
        const src = this.filePath + "." + i;
        const dest = this.filePath + "." + (i + 1);
        if (i === this.rotateKeep - 1) {
          await unlink(dest).catch(() => {});
        }
        await rename(src, dest).catch(() => {});
      }
      await rename(this.filePath, this.filePath + ".1").catch(() => {});

      this.fileStream = createWriteStream(this.filePath, {
        flags: "a",
        mode: 0o600,
      });
      this.bytesWritten = 0;
    } finally {
      this.rotating = false;
    }
  }
}
