import { resolve } from "node:path";
import { execa, type ResultPromise } from "execa";
import { toMs } from "../config/duration.js";
import type { ProjectConfig, SharedService as SharedServiceConfig } from "../config/schema.js";
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

export interface SharedServiceOpts {
  config: SharedServiceConfig;
  projectRoot: string;
  projectConfig: ProjectConfig;
  logBuffer?: LogBuffer;
}

/**
 * A project-scoped service. Runs once per project regardless of which
 * worktree is active. `cut` does not affect it. Lifecycle is owned by the
 * ProjectRuntime: started on register, stopped on shutdown.
 *
 * Conceptually a sibling of `Source` (per-worktree) — they share LogBuffer,
 * StateMachine, and the http-ready helper, but a SharedService has no
 * worktreePath, an optional port, and "always-ready" as a valid ready check.
 */
export class SharedService implements Lifecycle {
  readonly name: string;
  readonly cwd: string;
  readonly port: number | null;

  private readonly cfg: SharedServiceConfig;
  private readonly projectConfig: ProjectConfig;
  private readonly machine = new StateMachine();
  readonly logBuffer: LogBuffer;
  private readonly ownsLogBuffer: boolean;
  private downRequested = false;
  private splitter: LineSplitter;
  private child: ResultPromise | null = null;
  private abort: AbortController | null = null;
  /** Number of consecutive crash-restarts since last successful warm. */
  private restartAttempts = 0;
  private restartTimer: NodeJS.Timeout | null = null;

  constructor(opts: SharedServiceOpts) {
    this.cfg = opts.config;
    this.name = opts.config.name;
    this.cwd = resolve(opts.projectRoot, opts.config.cwd);
    this.port = opts.config.port ?? null;
    this.projectConfig = opts.projectConfig;
    if (opts.logBuffer) {
      this.logBuffer = opts.logBuffer;
      this.ownsLogBuffer = false;
    } else {
      this.logBuffer = new LogBuffer({ bufferLines: opts.projectConfig.log.buffer_lines });
      this.ownsLogBuffer = true;
    }
    this.splitter = new LineSplitter(this.logBuffer);
  }

  get state(): SourceState {
    return this.machine.state;
  }

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
      await this.waitForReady();
    } catch (err) {
      this.machine.transition("failed");
      await this.killChild();
      throw err;
    }

    if (this.machine.is("starting")) this.machine.transition("warm");
    // Successful warm — reset the backoff counter so the next crash starts
    // from `backoff_initial` again.
    this.restartAttempts = 0;
  }

  async down(): Promise<void> {
    this.downRequested = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (!this.machine.is("cold")) {
      this.abort?.abort("shared.down");
      await this.killChild();
      if (!this.machine.is("cold")) this.machine.transition("cold");
    }
    this.restartAttempts = 0;
    this.downRequested = false;
  }

  async closeLogBuffer(): Promise<void> {
    if (this.ownsLogBuffer) await this.logBuffer.close();
  }

  private async waitForReady(): Promise<void> {
    const ready = this.cfg.ready;
    if ("always" in ready) return;
    if (this.port == null) {
      throw new Error("ready.endpoint requires a port");
    }
    await waitForHttpReady({
      protocol: ready.protocol,
      port: this.port,
      path: ready.endpoint,
      timeout: ready.timeout,
      pollInterval: ready.poll_interval,
      signal: this.abort?.signal,
    });
  }

  private spawn(): ResultPromise {
    const child = execa(this.cfg.cmd, {
      cwd: this.cwd,
      env: this.buildEnv(),
      shell: true,
      stdio: "pipe",
      reject: false,
      detached: true,
    });
    child.stdout?.on("data", (b: Buffer) => this.splitter.feed("stdout", b));
    child.stderr?.on("data", (b: Buffer) => this.splitter.feed("stderr", b));
    return child;
  }

  private watchExit(child: ResultPromise): void {
    child
      .then((result) => {
        if (this.machine.is("cold") || this.downRequested) return;
        this.machine.transition("failed");
        if (!result.isCanceled) {
          logError(formatExitDiagnostic("shared service", this.name, result, this.logBuffer));
        }
        this.maybeScheduleRestart();
      })
      .catch((err) => logError(`shared service ${this.name} exit handler errored`, err));
  }

  /**
   * If the user opted in to `restart.on_crash`, schedule another `up()` with
   * exponential backoff (capped at `restart.backoff_max`). The counter is
   * reset by a successful `up()`. `down()` cancels any pending restart.
   */
  private maybeScheduleRestart(): void {
    const restart = this.cfg.restart;
    if (!restart.on_crash) return;
    if (this.downRequested) return;
    const initialMs = toMs(restart.backoff_initial);
    const maxMs = toMs(restart.backoff_max);
    const delay = Math.min(maxMs, initialMs * Math.pow(2, this.restartAttempts));
    this.restartAttempts += 1;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      // up() guards against state != cold|failed and against shutdown.
      this.up().catch((err) =>
        logError(`shared service ${this.name} restart attempt failed`, err),
      );
    }, delay);
    // Don't keep the event loop alive just for the restart timer.
    this.restartTimer.unref();
  }

  private async killChild(): Promise<void> {
    const child = this.child;
    if (!child || !child.pid) {
      this.child = null;
      return;
    }
    const graceMs = toMs(this.cfg.shutdown_timeout);
    killGroup(child.pid, "SIGTERM");
    const killer = setTimeout(() => killGroup(child.pid, "SIGKILL"), graceMs);
    try {
      await child;
    } catch {
      // signal-induced rejection expected
    } finally {
      clearTimeout(killer);
      this.child = null;
    }
  }

  private buildEnv(): NodeJS.ProcessEnv {
    const subs: Record<string, string> = {
      HOTCUT_NAME: this.name,
      HOTCUT_PROJECT: this.projectConfig.project.name,
      HOTCUT_ROOT: this.cwd,
      HOTCUT_SCOPE: "shared",
    };
    if (this.port != null) subs.HOTCUT_PORT = String(this.port);
    const expanded = expandEnv(this.cfg.env, subs);
    const out: NodeJS.ProcessEnv = { ...process.env, ...subs, ...expanded };
    if (this.port != null) out.PORT = String(this.port);
    return out;
  }
}
