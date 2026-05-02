import type { Source } from "../supervisor/source.js";

export interface ProgramTarget {
  port: number;
}

export interface CutResult {
  from: string | null;
  to: string;
}

export type ProgramListener = (event: CutResult) => void;

/**
 * The bus owns the "what's on program" pointer.
 * Proxy reads from it on every request; the CLI (or daemon) calls cut()
 * to flip it.
 */
export class Bus {
  private program: Source | null = null;
  private readonly listeners = new Set<ProgramListener>();

  programName(): string | null {
    return this.program?.name ?? null;
  }

  programTarget(): ProgramTarget | null {
    if (!this.program || this.program.state !== "warm") return null;
    return { port: this.program.port };
  }

  cut(source: Source): CutResult {
    const from = this.program?.name ?? null;
    const to = source.name;
    if (from === to) return { from, to };
    this.program = source;
    const event: CutResult = { from, to };
    for (const l of this.listeners) l(event);
    return event;
  }

  clear(): void {
    if (this.program === null) return;
    const from = this.program.name;
    this.program = null;
    for (const l of this.listeners) l({ from, to: "" });
  }

  onCut(listener: ProgramListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
