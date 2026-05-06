import { execa } from "execa";
import { resolve } from "node:path";
import type { ProjectConfig, SetupStep } from "../config/schema.js";
import { toMs } from "../config/duration.js";
import { LogBuffer } from "./log-buffer.js";
import { expandEnv, LineSplitter } from "./process-helpers.js";
import { logError } from "../util/log.js";

export type SetupStepState = "pending" | "running" | "done" | "failed";

export interface SetupStepStatus {
  name: string;
  state: SetupStepState;
  error: string | null;
  startedAt: number | null;
  endedAt: number | null;
}

export interface SetupRunnerOpts {
  projectRoot: string;
  projectConfig: ProjectConfig;
  steps: SetupStep[];
  /** Per-step log buffers. Created lazily in the runner if not provided. */
  logBufferFor?: (stepName: string) => LogBuffer;
  /** Notified after every status change so callers can refresh status. */
  onChange?: () => void;
}

/**
 * Runs project-level setup steps sequentially before any source/shared service
 * is brought up. Each step's stdout/stderr is captured into a per-step
 * LogBuffer (so `hotcut logs <step>` works just like for sources/shared).
 *
 * Failures abort the run: the failing step is marked `failed`, remaining steps
 * stay `pending`, and `run()` rejects.
 */
export class SetupRunner {
  private readonly statuses: SetupStepStatus[];
  private readonly buffers = new Map<string, LogBuffer>();
  private done = false;
  private failed = false;

  constructor(private readonly opts: SetupRunnerOpts) {
    this.statuses = opts.steps.map((s) => ({
      name: s.name,
      state: "pending",
      error: null,
      startedAt: null,
      endedAt: null,
    }));
    for (const s of opts.steps) {
      const buf = opts.logBufferFor?.(s.name) ?? new LogBuffer({ bufferLines: 200 });
      this.buffers.set(s.name, buf);
    }
  }

  status(): SetupStepStatus[] {
    // Defensive copy so external mutation can't corrupt internal state.
    return this.statuses.map((s) => ({ ...s }));
  }

  /** True once `run()` has resolved or rejected. */
  isDone(): boolean { return this.done; }
  /** True iff a step failed; `run()` rejected. */
  hasFailed(): boolean { return this.failed; }

  getBuffer(stepName: string): LogBuffer | undefined {
    return this.buffers.get(stepName);
  }

  async closeBuffers(): Promise<void> {
    await Promise.all([...this.buffers.values()].map((b) => b.close().catch(() => {})));
  }

  async run(): Promise<void> {
    for (let i = 0; i < this.opts.steps.length; i++) {
      const step = this.opts.steps[i]!;
      const status = this.statuses[i]!;
      status.state = "running";
      status.startedAt = Date.now();
      this.opts.onChange?.();
      try {
        await this.runStep(step);
        status.state = "done";
        status.endedAt = Date.now();
        this.opts.onChange?.();
      } catch (err) {
        status.state = "failed";
        status.error = err instanceof Error ? err.message : String(err);
        status.endedAt = Date.now();
        this.failed = true;
        this.done = true;
        this.opts.onChange?.();
        throw err;
      }
    }
    this.done = true;
  }

  private async runStep(step: SetupStep): Promise<void> {
    const buffer = this.buffers.get(step.name)!;
    const splitter = new LineSplitter(buffer);
    const cwd = resolve(this.opts.projectRoot, step.cwd);
    const env = this.buildEnv(step);
    const timeoutMs = toMs(step.timeout);
    const child = execa(step.cmd, {
      cwd,
      env,
      shell: true,
      stdio: "pipe",
      reject: false,
      timeout: timeoutMs,
    });
    child.stdout?.on("data", (b: Buffer) => splitter.feed("stdout", b));
    child.stderr?.on("data", (b: Buffer) => splitter.feed("stderr", b));
    let result;
    try {
      result = await child;
    } catch (err) {
      logError(`setup step ${step.name} crashed`, err);
      throw new Error(`setup step '${step.name}' crashed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (result.timedOut) {
      throw new Error(`setup step '${step.name}' timed out after ${step.timeout}`);
    }
    if (result.exitCode !== 0) {
      const tail = buffer.recent(5).map((e) => "  " + e.line).join("\n");
      const codeBit = `exit ${result.exitCode}` + (result.signal ? `, signal=${result.signal}` : "");
      throw new Error(`setup step '${step.name}' failed (${codeBit})${tail ? "\n" + tail : ""}`);
    }
  }

  private buildEnv(step: SetupStep): NodeJS.ProcessEnv {
    const subs: Record<string, string> = {
      HOTCUT_PROJECT: this.opts.projectConfig.project.name,
      HOTCUT_ROOT: this.opts.projectRoot,
      HOTCUT_SETUP_STEP: step.name,
    };
    const projectEnv = expandEnv(this.opts.projectConfig.env as Record<string, string>, subs);
    const stepEnv = expandEnv(step.env as Record<string, string>, subs);
    return { ...process.env, ...subs, ...projectEnv, ...stepEnv };
  }
}
