import { execa, type ResultPromise } from "execa";
import { toMs } from "../config/duration.js";
import type { ProjectConfig } from "../config/schema.js";
import { logError, prefixedLogger } from "../util/log.js";
import { waitForHttpReady } from "./ready.js";
import { StateMachine, type SourceState } from "./state.js";

export interface SourceOpts {
  name: string;
  worktreePath: string;
  port: number;
  config: ProjectConfig;
}

const ENV_VAR_PATTERN = /\$([A-Z_][A-Z0-9_]*)/g;

export class Source {
  readonly name: string;
  readonly worktreePath: string;
  readonly port: number;

  private readonly config: ProjectConfig;
  private readonly machine = new StateMachine();
  private downRequested = false;
  private readonly logger;
  private child: ResultPromise | null = null;
  private abort: AbortController | null = null;

  constructor(opts: SourceOpts) {
    this.name = opts.name;
    this.worktreePath = opts.worktreePath;
    this.port = opts.port;
    this.config = opts.config;
    this.logger = prefixedLogger(`[${this.name}]`);
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
    });

    child.stdout?.on("data", (b: Buffer) => this.logger.write("stdout", b));
    child.stderr?.on("data", (b: Buffer) => this.logger.write("stderr", b));

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
    child.kill("SIGTERM");
    const killer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // already dead
      }
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

// Re-export to keep callers stable when they import { SourceState } from this module.
export type { SourceState } from "./state.js";

