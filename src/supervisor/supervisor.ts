import type { ProjectConfig } from "../config/schema.js";
import type { DiscoveredSource } from "../discovery/discovery.js";
import { findFreePort } from "./port.js";
import { Source } from "./source.js";
import type { SourceState } from "./state.js";

export interface SupervisorOpts {
  reservedPorts?: ReadonlySet<number>;
  portRangeStart?: number;
  portRangeEnd?: number;
}

export interface SupervisorEntry {
  source: Source;
  state: SourceState;
}

export type SupervisorListener = (entry: SupervisorEntry) => void;

/**
 * Owns the registered set of sources and their state.
 * The CLI/daemon asks it to register sources, warm them, tear them down.
 * Doesn't know about the proxy or the program pointer — that's the Bus.
 */
export class Supervisor {
  private readonly sources = new Map<string, Source>();
  private readonly listeners = new Set<SupervisorListener>();
  private readonly config: ProjectConfig;
  private readonly opts: SupervisorOpts;

  constructor(config: ProjectConfig, opts: SupervisorOpts = {}) {
    this.config = config;
    this.opts = opts;
  }

  list(): Source[] {
    return [...this.sources.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  get(name: string): Source | undefined {
    return this.sources.get(name);
  }

  async register(discovered: DiscoveredSource): Promise<Source> {
    if (this.sources.has(discovered.name)) {
      throw new Error(`source already registered: ${discovered.name}`);
    }
    const usedPorts = new Set<number>(this.opts.reservedPorts ?? []);
    for (const s of this.sources.values()) usedPorts.add(s.port);
    const port = await findFreePort({
      exclude: usedPorts,
      start: this.opts.portRangeStart,
      end: this.opts.portRangeEnd,
    });
    const source = new Source({
      name: discovered.name,
      worktreePath: discovered.worktreePath,
      port,
      config: this.config,
    });
    source.onStateChange(() => this.notify(source));
    this.sources.set(source.name, source);
    this.notify(source);
    return source;
  }

  /** Warm every cold source in parallel. Resolves once each has settled (warm or failed). */
  async upAll(): Promise<void> {
    await Promise.allSettled(
      this.list().map((s) => (s.state === "cold" ? s.up() : Promise.resolve())),
    );
  }

  async downAll(): Promise<void> {
    await Promise.allSettled(this.list().map((s) => s.down()));
  }

  onChange(listener: SupervisorListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(source: Source): void {
    const entry = { source, state: source.state };
    for (const l of this.listeners) l(entry);
  }
}
