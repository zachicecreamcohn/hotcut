import { execa, type ResultPromise } from "execa";
import { toMs } from "../config/duration.js";
import type { ProjectConfig } from "../config/schema.js";
import { logError } from "../util/log.js";
import { LogBuffer, type LogStream } from "./log-buffer.js";
import { waitForHttpReady } from "./ready.js";
import { StateMachine, type SourceState } from "./state.js";

export interface SourceOpts {
  name: string;
  worktreePath: string;
  port: number;
  config: ProjectConfig;
  logBuffer?: LogBuffer;
}

const ENV_VAR_PATTERN = /\$([A-Z_][A-Z0-9_]*)/g;

export class Source {
  readonly name: string;
  readonly worktreePath: string;
  readonly port: number;

  private readonly config: ProjectConfig;
  private readonly machine = new StateMachine();
  private downRequested = false;
  readonly logBuffer: LogBuffer;
  private readonly ownsLogBuffer: boolean;
  private stdoutCarry = "";
  private stderrCarry = "";
  private child: ResultPromise | null = null;
  private abort: AbortController | null = null;

  constructor(opts: SourceOpts) {
    this.name = opts.name;
    this.worktreePath = opts.worktreePath;
    this.port = opts.port;
    this.config = opts.config;
    if (opts.logBuffer) {
      this.logBuffer = opts.logBuffer;
      this.ownsLogBuffer = false;
    } else {
      this.logBuffer = new LogBuffer({
        bufferLines: this.config.log.buffer_lines,
      });
      this.ownsLogBuffer = true;
    }
  }

  get state(): SourceState {
    return this.machine.state;
  }

  onStateChange(listener: (e: { from: SourceState; to: SourceState }) => void): () => void {
    this.machine.on("change", listener);
    return () => this.machine.off("change", listener);
  }

  async up(): Promise<void> {
    if (!this.machine.is("cold", "failed")) return;
    this.machine.transition("starting");
    this.abort = new AbortController();

    const child = this.spawn();
    this.child = child;
    this.watchExit(child);

    try {
      await waitForHttpReady({
        port: this.port,
        path: this.config.run.ready.http,
        timeout: this.config.run.ready.timeout,
        pollInterval: this.config.run.ready.poll_interval,
        signal: this.abort.signal,
      });
    } catch (err) {
      this.machine.transition("failed");
      await this.killChild();
      throw err;
    }

    if (this.machine.is("starting")) {
      this.machine.transition("warm");
    }
  }

  async down(): Promise<void> {
    if (this.machine.is("cold")) return;
    this.downRequested = true;
    this.abort?.abort("source.down");
    await this.killChild();
    if (!this.machine.is("cold")) this.machine.transition("cold");
    this.downRequested = false;
  }

  private spawn(): ResultPromise {
    const child = execa(this.config.run.cmd, {
      cwd: this.worktreePath,
      env: this.buildEnv(),
      shell: true,
      stdio: "pipe",
      reject: false,
      // Run in its own process group so we can SIGTERM the whole tree
      // (e.g. when `cmd` is `npm-run-all` which forks several grandchildren).
      detached: true,
    });

    child.stdout?.on("data", (b: Buffer) => this.onChunk("stdout", b));
    child.stderr?.on("data", (b: Buffer) => this.onChunk("stderr", b));

    return child;
  }

  private watchExit(child: ResultPromise): void {
    child
      .then((result) => {
        // Expected: down() set state to cold (or in flight) — we initiated this.
        if (this.machine.is("cold") || this.downRequested) return;
        this.machine.transition("failed");
        if (!result.isCanceled) {
          logError(
            `source ${this.name} exited unexpectedly (code=${result.exitCode ?? "?"})`,
          );
        }
      })
      .catch((err) => logError(`source ${this.name} exit handler errored`, err));
  }

  private async killChild(): Promise<void> {
    const child = this.child;
    if (!child || !child.pid) {
      this.child = null;
      return;
    }
    const graceMs = toMs(this.config.run.shutdown_timeout);
    killGroup(child.pid, "SIGTERM");
    const killer = setTimeout(() => {
      killGroup(child.pid, "SIGKILL");
    }, graceMs);
    try {
      await child;
    } catch {
      // child rejection on signal is expected
    } finally {
      clearTimeout(killer);
      this.child = null;
    }
  }

  private onChunk(stream: LogStream, chunk: Buffer): void {
    const text = chunk.toString("utf8");
    const carry = stream === "stdout" ? this.stdoutCarry : this.stderrCarry;
    const combined = carry + text;
    const parts = combined.split("\n");
    const trailing = parts.pop() ?? "";
    if (stream === "stdout") this.stdoutCarry = trailing;
    else this.stderrCarry = trailing;
    for (const line of parts) {
      this.logBuffer.append(stream, line);
    }
  }

  /** Release log file handles. Safe to call multiple times. */
  async closeLogBuffer(): Promise<void> {
    if (this.ownsLogBuffer) await this.logBuffer.close();
  }

  private buildEnv(): NodeJS.ProcessEnv {
    const subs: Record<string, string> = {
      HOTCUT_PORT: String(this.port),
      HOTCUT_NAME: this.name,
      HOTCUT_PROJECT: this.config.project.name,
      HOTCUT_ROOT: this.worktreePath,
    };
    const out: NodeJS.ProcessEnv = { ...process.env, ...subs };
    for (const [k, v] of Object.entries(this.config.env)) {
      out[k] = v.replace(ENV_VAR_PATTERN, (_m, name: string) => {
        return subs[name] ?? process.env[name] ?? "";
      });
    }
    return out;
  }
}

function killGroup(pid: number | undefined, signal: "SIGTERM" | "SIGKILL"): void {
  if (!pid) return;
  try {
    // Negative pid signals the whole process group (created via detached: true).
    process.kill(-pid, signal);
  } catch {
    // Group already gone — fall back to direct kill in case the leader survived.
    try {
      process.kill(pid, signal);
    } catch {
      // already dead
    }
  }
}

// Re-export to keep callers stable when they import { SourceState } from this module.
export type { SourceState } from "./state.js";

