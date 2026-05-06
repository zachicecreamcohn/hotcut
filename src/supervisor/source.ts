import { execa, type ResultPromise } from "execa";
import { toMs } from "../config/duration.js";
import type { ProjectConfig } from "../config/schema.js";
import { logError } from "../util/log.js";
import { LogBuffer } from "./log-buffer.js";
import {
  expandEnv,
  formatExitDiagnostic,
  killGroup,
  LineSplitter,
  type Lifecycle,
} from "./process-helpers.js";
import { waitForHttpReady } from "./ready.js";
import { StateMachine, type SourceState } from "./state.js";

export interface SourceOpts {
  name: string;
  worktreePath: string;
  port: number;
  config: ProjectConfig;
  logBuffer?: LogBuffer;
}

export class Source implements Lifecycle {
  readonly name: string;
  readonly worktreePath: string;
  readonly port: number;

  private readonly config: ProjectConfig;
  private readonly machine = new StateMachine();
  private downRequested = false;
  readonly logBuffer: LogBuffer;
  private readonly ownsLogBuffer: boolean;
  private splitter: LineSplitter;
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
    this.splitter = new LineSplitter(this.logBuffer);
  }

  get state(): SourceState {
    return this.machine.state;
  }

  /**
   * PID of the detached child shell (also the PGID of the worktree's process
   * group, since we spawn with `detached: true`). null if no child is alive.
   */
  get pid(): number | null {
    return this.child?.pid ?? null;
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
        protocol: this.config.run.ready.protocol,
        port: this.port,
        path: this.config.run.ready.endpoint,
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

    child.stdout?.on("data", (b: Buffer) => this.splitter.feed("stdout", b));
    child.stderr?.on("data", (b: Buffer) => this.splitter.feed("stderr", b));

    return child;
  }

  private watchExit(child: ResultPromise): void {
    child
      .then((result) => {
        // Expected: down() set state to cold (or in flight) — we initiated this.
        if (this.machine.is("cold") || this.downRequested) return;
        this.machine.transition("failed");
        if (!result.isCanceled) {
          logError(formatExitDiagnostic("source", this.name, result, this.logBuffer));
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
    const expanded = expandEnv(this.config.env as Record<string, string>, subs);
    return { ...process.env, ...subs, ...expanded };
  }
}

// Re-export to keep callers stable when they import { SourceState } from this module.
export type { SourceState } from "./state.js";

