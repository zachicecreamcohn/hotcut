import { resolve } from "node:path";
import { execa, type ResultPromise } from "execa";
import { toMs } from "../config/duration.js";
import type { ProjectConfig, SharedService as SharedServiceConfig } from "../config/schema.js";
import { logError } from "../util/log.js";
import { LogBuffer, type LogStream } from "./log-buffer.js";
import { waitForHttpReady } from "./ready.js";
import { StateMachine, type SourceState } from "./state.js";

const ENV_VAR_PATTERN = /\$([A-Z_][A-Z0-9_]*)/g;

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
export class SharedService {
  readonly name: string;
  readonly cwd: string;
  readonly port: number | null;

  private readonly cfg: SharedServiceConfig;
  private readonly projectConfig: ProjectConfig;
  private readonly machine = new StateMachine();
  readonly logBuffer: LogBuffer;
  private readonly ownsLogBuffer: boolean;
  private downRequested = false;
  private stdoutCarry = "";
  private stderrCarry = "";
  private child: ResultPromise | null = null;
  private abort: AbortController | null = null;

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
  }

  async down(): Promise<void> {
    if (this.machine.is("cold")) return;
    this.downRequested = true;
    this.abort?.abort("shared.down");
    await this.killChild();
    if (!this.machine.is("cold")) this.machine.transition("cold");
    this.downRequested = false;
  }

  async closeLogBuffer(): Promise<void> {
    if (this.ownsLogBuffer) await this.logBuffer.close();
  }

  private async waitForReady(): Promise<void> {
    const ready = this.cfg.ready;
    if ("always" in ready) return;
    if (this.port == null) {
      throw new Error("ready.http requires a port");
    }
    await waitForHttpReady({
      port: this.port,
      path: ready.http,
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
    child.stdout?.on("data", (b: Buffer) => this.onChunk("stdout", b));
    child.stderr?.on("data", (b: Buffer) => this.onChunk("stderr", b));
    return child;
  }

  private watchExit(child: ResultPromise): void {
    child
      .then((result) => {
        if (this.machine.is("cold") || this.downRequested) return;
        this.machine.transition("failed");
        if (!result.isCanceled) {
          logError(
            `shared service ${this.name} exited unexpectedly (code=${result.exitCode ?? "?"})`,
          );
        }
      })
      .catch((err) => logError(`shared service ${this.name} exit handler errored`, err));
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

  private onChunk(stream: LogStream, chunk: Buffer): void {
    const text = chunk.toString("utf8");
    const carry = stream === "stdout" ? this.stdoutCarry : this.stderrCarry;
    const combined = carry + text;
    const parts = combined.split("\n");
    const trailing = parts.pop() ?? "";
    if (stream === "stdout") this.stdoutCarry = trailing;
    else this.stderrCarry = trailing;
    for (const line of parts) this.logBuffer.append(stream, line);
  }

  private buildEnv(): NodeJS.ProcessEnv {
    const subs: Record<string, string> = {
      HOTCUT_NAME: this.name,
      HOTCUT_PROJECT: this.projectConfig.project.name,
      HOTCUT_ROOT: this.cwd,
      HOTCUT_SCOPE: "shared",
    };
    if (this.port != null) subs.HOTCUT_PORT = String(this.port);
    const out: NodeJS.ProcessEnv = { ...process.env, ...subs };
    if (this.port != null) out.PORT = String(this.port);
    for (const [k, v] of Object.entries(this.cfg.env)) {
      out[k] = v.replace(ENV_VAR_PATTERN, (_m, n: string) => subs[n] ?? process.env[n] ?? "");
    }
    return out;
  }
}

function killGroup(pid: number | undefined, signal: "SIGTERM" | "SIGKILL"): void {
  if (!pid) return;
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // already dead
    }
  }
}
