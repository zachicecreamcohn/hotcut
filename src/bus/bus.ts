import type { Source } from "../supervisor/source.js";

export interface ProgramTarget {
  port: number;
}

/**
 * The bus owns the "what's on program" pointer.
 * The proxy reads from it on every request; the supervisor (or CLI in slice 1)
 * writes to it when a cut happens.
 */
export class Bus {
  private program: Source | null = null;

  setProgram(source: Source | null): void {
    this.program = source;
  }

  programName(): string | null {
    return this.program?.name ?? null;
  }

  programTarget(): ProgramTarget | null {
    if (!this.program || this.program.state !== "warm") return null;
    return { port: this.program.port };
  }
}
