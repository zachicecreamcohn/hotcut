import { join } from "node:path";
import type { ProjectConfig } from "../config/schema.js";
import type { DiscoveredSource } from "../discovery/discovery.js";
import { DiscoveryWatcher } from "../discovery/watcher.js";
import { Bus } from "../bus/bus.js";
import { startProxy, type ProxyServer } from "../proxy/server.js";
import { LogBuffer } from "../supervisor/log-buffer.js";
import { Supervisor } from "../supervisor/supervisor.js";
import type { Source } from "../supervisor/source.js";
import { SharedService } from "../supervisor/shared-service.js";
import { SetupRunner, type SetupStepStatus } from "../supervisor/setup-runner.js";
import type { Lifecycle } from "../supervisor/process-helpers.js";
import {
  ERROR_CODES,
  ProtocolError,
} from "../proto/errors.js";
import { log, logError } from "../util/log.js";
import { runWithConcurrency } from "../util/concurrency.js";
import type {
  CutResult,
  DownResult,
  ProjectStatusDto,
  SetupStatusDto,
  SharedStatusDto,
  SourceStatusDto,
  UpResult,
} from "../proto/schema.js";

export interface ProjectRuntimeOpts {
  root: string;
  config: ProjectConfig;
  onChange?: () => void;
  portRangeStart?: number;
  enableWatcher?: boolean;
  /** Directory where per-source log files are written (e.g. <stateDir>/logs). */
  logsDir?: string;
}

export class ProjectRuntime {
  readonly root: string;
  readonly config: ProjectConfig;
  private readonly supervisor: Supervisor;
  private readonly bus: Bus;
  private proxy: ProxyServer | null = null;
  private readonly onChange?: () => void;
  private shutdownInProgress = false;
  private watcher: DiscoveryWatcher | null = null;
  private readonly enableWatcher: boolean;
  private readonly shared: SharedService[];
  private readonly setupRunner: SetupRunner | null;
  /**
   * Promises for in-flight eager-start of shared services. Tests await this
   * to avoid polling; production code can ignore it (failures are also
   * surfaced via `status`).
   */
  private sharedStartPromises: Promise<void>[] = [];

  constructor(opts: ProjectRuntimeOpts) {
    this.root = opts.root;
    this.config = opts.config;
    this.onChange = opts.onChange;
    this.enableWatcher = opts.enableWatcher ?? true;
    const logsDir = opts.logsDir;
    const projectName = opts.config.project.name;
    const reserved = new Set<number>([opts.config.project.proxy_port]);
    for (const s of opts.config.shared) {
      if (s.port != null) reserved.add(s.port);
    }
    this.shared = opts.config.shared.map(
      (s) =>
        new SharedService({
          config: s,
          projectRoot: opts.root,
          projectConfig: opts.config,
          logBuffer: new LogBuffer({
            bufferLines: opts.config.log.buffer_lines,
            filePath: logsDir
              ? join(logsDir, projectName, "shared", s.name + ".log")
              : undefined,
          }),
        }),
    );
    for (const sh of this.shared) {
      sh.onStateChange(() => this.onChange?.());
    }
    this.setupRunner = opts.config.setup.length === 0
      ? null
      : new SetupRunner({
          projectRoot: opts.root,
          projectConfig: opts.config,
          steps: opts.config.setup,
          logBufferFor: (stepName) =>
            new LogBuffer({
              bufferLines: opts.config.log.buffer_lines,
              filePath: logsDir
                ? join(logsDir, projectName, "setup", stepName + ".log")
                : undefined,
            }),
          onChange: () => this.onChange?.(),
        });
    this.supervisor = new Supervisor(opts.config, {
      reservedPorts: reserved,
      portRangeStart: opts.portRangeStart,
      logBufferFor: (sourceName) =>
        new LogBuffer({
          bufferLines: opts.config.log.buffer_lines,
          filePath: logsDir
            ? join(logsDir, projectName, sourceName + ".log")
            : undefined,
        }),
    });
    this.bus = new Bus();
    this.supervisor.onChange((entry) => {
      // If a source warmed up and nothing is on program, promote it.
      // This mirrors slice 2's "first warm source becomes program" behavior.
      if (entry.state === "warm" && this.bus.programName() === null) {
        this.bus.cut(entry.source);
      }
      this.onChange?.();
    });
    this.bus.onCut(() => this.onChange?.());
  }

  get name(): string {
    return this.config.project.name;
  }

  get proxyPort(): number {
    return this.config.project.proxy_port;
  }

  async start(): Promise<void> {
    if (this.proxy) return;
    // Run project setup steps first. These are one-shot scripts (e.g.
    // `docker compose up -d`) that must succeed before anything else starts.
    // Failures abort registration with a clear error.
    if (this.setupRunner) {
      try {
        await this.setupRunner.run();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new ProtocolError(ERROR_CODES.CONFIG_INVALID, "setup: " + msg);
      }
    }
    this.proxy = await startProxy(this.config.project.proxy_port, this.bus);
    // Eager start: bring up shared services as soon as the project is registered.
    // Failures are logged but don't block the project — partial startup is
    // visible via `hotcut status` and can be retried with `hotcut up`.
    this.sharedStartPromises = this.shared.map((sh) =>
      sh.up().catch((err) => {
        logError("shared service " + sh.name + " failed to start", err);
      }),
    );
    if (this.enableWatcher) {
      this.watcher = new DiscoveryWatcher(this.root, this.config, {
        add: (src) => void this.onWatcherAdd(src),
        remove: (name) => void this.onWatcherRemove(name),
      });
      try {
        await this.watcher.start();
      } catch (err) {
        logError("watcher failed to start; auto-discovery disabled", err);
        this.watcher = null;
      }
    }
  }

  async register(discovered: DiscoveredSource): Promise<Source> {
    const existing = this.supervisor.get(discovered.name);
    if (existing) return existing;
    if (this.shared.some((s) => s.name === discovered.name)) {
      throw new ProtocolError(
        ERROR_CODES.CONFIG_INVALID,
        "worktree name '" + discovered.name + "' collides with a [[shared]] service of the same name; rename one",
      );
    }
    return this.supervisor.register(discovered);
  }

  async up(name?: string): Promise<UpResult> {
    if (this.shutdownInProgress) {
      throw new ProtocolError(ERROR_CODES.SHUTDOWN_IN_PROGRESS, "daemon shutting down");
    }
    let targets: Lifecycle[];
    if (name) {
      targets = [this.requireTarget(name)];
    } else {
      targets = [...this.supervisor.list(), ...this.shared];
    }
    const started: string[] = [];
    const alreadyWarm: string[] = [];
    const failed: { name: string; error: string }[] = [];
    const work = targets.map((s) => async () => {
      if (s.state === "warm") {
        alreadyWarm.push(s.name);
        return;
      }
      try {
        await s.up();
        started.push(s.name);
      } catch (err) {
        failed.push({
          name: s.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
    // For a named single-target `up`, run directly. For bulk warm, bound by
    // config.run.warm_concurrency to avoid melting the host.
    const limit = name ? targets.length : this.config.run.warm_concurrency;
    await runWithConcurrency(Math.max(1, limit), work, (fn) => fn());
    return { started, alreadyWarm, failed };
  }

  async down(name?: string): Promise<DownResult> {
    let targets: Lifecycle[];
    if (name) {
      targets = [this.requireTarget(name)];
    } else {
      this.bus.clear();
      targets = [...this.supervisor.list(), ...this.shared];
    }
    const stopped: string[] = [];
    await Promise.all(
      targets.map(async (s) => {
        if (s.state === "cold") return;
        await s.down();
        stopped.push(s.name);
      }),
    );
    return { stopped };
  }

  async cut(name: string, opts: { wait?: boolean } = {}): Promise<CutResult> {
    if (this.shutdownInProgress) {
      throw new ProtocolError(ERROR_CODES.SHUTDOWN_IN_PROGRESS, "daemon shutting down");
    }
    const source = this.requireSource(name);
    const wait = opts.wait !== false;
    const startedAt = Date.now();
    if (source.state === "cold" || source.state === "failed") {
      if (wait) {
        try {
          await source.up();
        } catch (err) {
          const base = err instanceof Error ? err.message : String(err);
          const tail = source.logBuffer
            .recent(10)
            .map((e) => "  " + e.line)
            .join("\n");
          const msg = tail
            ? base + "\n\nlast log lines:\n" + tail + "\n\nhint: hotcut logs " + name
            : base + "\n\nhint: hotcut logs " + name;
          throw new ProtocolError(ERROR_CODES.READY_TIMEOUT, msg);
        }
      } else {
        void source.up().catch(() => {});
      }
    }
    this.bus.cut(source);
    const port = this.proxy?.port ?? this.config.project.proxy_port;
    return {
      program: source.name,
      url: "http://localhost:" + port,
      tookMs: Date.now() - startedAt,
    };
  }

  status(): ProjectStatusDto {
    const program = this.bus.programName();
    const sources: SourceStatusDto[] = this.supervisor.list().map((s) => ({
      name: s.name,
      state: s.state,
      port: s.state === "cold" || s.state === "failed" ? null : s.port,
      onProgram: s.name === program,
    }));
    const shared: SharedStatusDto[] = this.shared.map((s) => ({
      name: s.name,
      state: s.state,
      port: s.state === "cold" || s.state === "failed" ? null : s.port,
    }));
    const setup: SetupStatusDto[] = (this.setupRunner?.status() ?? []).map((s) => ({
      name: s.name,
      state: s.state,
      error: s.error,
    }));
    return {
      name: this.config.project.name,
      root: this.root,
      program,
      proxyPort: this.config.project.proxy_port,
      sources,
      shared,
      setup,
    };
  }

  private shutdownComplete = false;

  async shutdown(): Promise<void> {
    if (this.shutdownComplete) return;
    this.shutdownInProgress = true;
    if (this.watcher) {
      await this.watcher.stop().catch(() => {});
      this.watcher = null;
    }
    if (this.proxy) {
      await this.proxy.close();
      this.proxy = null;
    }
    await this.supervisor.downAll();
    await Promise.allSettled(this.shared.map((s) => s.down()));
    await Promise.allSettled(this.shared.map((s) => s.closeLogBuffer()));
    if (this.setupRunner) await this.setupRunner.closeBuffers();
    this.shutdownComplete = true;
  }

  private async onWatcherAdd(src: DiscoveredSource): Promise<void> {
    if (this.shutdownInProgress) return;
    if (this.supervisor.get(src.name)) return;
    try {
      await this.supervisor.register(src);
      log("discovered new worktree: " + src.name);
    } catch (err) {
      logError("failed to register " + src.name, err);
    }
  }

  private async onWatcherRemove(name: string): Promise<void> {
    if (this.shutdownInProgress) return;
    if (!this.supervisor.get(name)) return;
    if (this.bus.programName() === name) this.bus.clear();
    await this.supervisor.unregister(name).catch((err) => {
      logError("failed to unregister " + name, err);
    });
    log("worktree removed: " + name);
  }

  getSource(name: string): Source | undefined {
    return this.supervisor.get(name);
  }

  getShared(name: string): SharedService | undefined {
    return this.shared.find((s) => s.name === name);
  }

  /** Returns a setup-step's log buffer if such a step is configured. */
  getSetupLogBuffer(name: string): { logBuffer: import("../supervisor/log-buffer.js").LogBuffer } | undefined {
    const buf = this.setupRunner?.getBuffer(name);
    return buf ? { logBuffer: buf } : undefined;
  }

  /**
   * Resolves once every shared service has either reached `warm` or `failed`.
   * Useful in tests; production callers don't generally need to await this.
   */
  async whenSharedSettled(): Promise<void> {
    await Promise.allSettled(this.sharedStartPromises);
  }

  listSharedNames(): string[] {
    return this.shared.map((s) => s.name);
  }

  listSourceNames(): string[] {
    return this.supervisor.list().map((s) => s.name);
  }

  sourcePorts(): { name: string; port: number; pid: number | null }[] {
    return this.supervisor
      .list()
      .map((s) => ({ name: s.name, port: s.port, pid: s.pid }));
  }

  private requireSource(name: string): Source {
    const s = this.supervisor.get(name);
    if (!s) {
      throw new ProtocolError(
        ERROR_CODES.SOURCE_NOT_FOUND,
        "source not found: " + name,
      );
    }
    return s;
  }

  /**
   * Resolve a name to either a worktree source or a shared service. The
   * config-time validation in `ProjectConfig.superRefine` guarantees no
   * name collisions, so we can pick whichever is present.
   */
  private requireTarget(name: string): Lifecycle {
    const sh = this.shared.find((s) => s.name === name);
    if (sh) return sh;
    const src = this.supervisor.get(name);
    if (src) return src;
    throw new ProtocolError(
      ERROR_CODES.SOURCE_NOT_FOUND,
      "no worktree or shared service named: " + name,
    );
  }
}
