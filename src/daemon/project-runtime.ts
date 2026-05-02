import { join } from "node:path";
import type { ProjectConfig } from "../config/schema.js";
import type { DiscoveredSource } from "../discovery/discovery.js";
import { DiscoveryWatcher } from "../discovery/watcher.js";
import { Bus } from "../bus/bus.js";
import { startProxy, type ProxyServer } from "../proxy/server.js";
import { LogBuffer } from "../supervisor/log-buffer.js";
import { Supervisor } from "../supervisor/supervisor.js";
import type { Source } from "../supervisor/source.js";
import {
  ERROR_CODES,
  ProtocolError,
} from "../proto/errors.js";
import { log, logError } from "../util/log.js";
import type {
  CutResult,
  DownResult,
  ProjectStatusDto,
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

  constructor(opts: ProjectRuntimeOpts) {
    this.root = opts.root;
    this.config = opts.config;
    this.onChange = opts.onChange;
    this.enableWatcher = opts.enableWatcher ?? true;
    const logsDir = opts.logsDir;
    this.supervisor = new Supervisor(opts.config, {
      reservedPorts: new Set([opts.config.project.proxy_port]),
      portRangeStart: opts.portRangeStart,
      logBufferFor: (sourceName) =>
        new LogBuffer({
          bufferLines: opts.config.log.buffer_lines,
          filePath: logsDir
            ? join(logsDir, opts.config.project.name, sourceName + ".log")
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
    this.proxy = await startProxy(this.config.project.proxy_port, this.bus);
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
    return this.supervisor.register(discovered);
  }

  async up(name?: string): Promise<UpResult> {
    if (this.shutdownInProgress) {
      throw new ProtocolError(ERROR_CODES.SHUTDOWN_IN_PROGRESS, "daemon shutting down");
    }
    const targets = name ? [this.requireSource(name)] : this.supervisor.list();
    const started: string[] = [];
    const alreadyWarm: string[] = [];
    const failed: { name: string; error: string }[] = [];
    await Promise.all(
      targets.map(async (s) => {
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
      }),
    );
    return { started, alreadyWarm, failed };
  }

  async down(name?: string): Promise<DownResult> {
    const targets = name ? [this.requireSource(name)] : this.supervisor.list();
    const stopped: string[] = [];
    if (!name) {
      this.bus.clear();
    }
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
    return {
      name: this.config.project.name,
      root: this.root,
      program,
      proxyPort: this.config.project.proxy_port,
      sources,
    };
  }

  async shutdown(): Promise<void> {
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

  listSourceNames(): string[] {
    return this.supervisor.list().map((s) => s.name);
  }

  sourcePorts(): { name: string; port: number }[] {
    return this.supervisor.list().map((s) => ({ name: s.name, port: s.port }));
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
}
