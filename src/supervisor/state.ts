export type SourceState = "cold" | "starting" | "warm" | "failed";

const LEGAL: Record<SourceState, ReadonlySet<SourceState>> = {
  cold: new Set(["starting"]),
  starting: new Set(["warm", "failed", "cold"]),
  warm: new Set(["cold", "failed"]),
  failed: new Set(["cold", "starting"]),
};

export class IllegalTransitionError extends Error {
  constructor(from: SourceState, to: SourceState) {
    super(`illegal source transition: ${from} -> ${to}`);
    this.name = "IllegalTransitionError";
  }
}

export class StateMachine {
  private current: SourceState = "cold";

  get state(): SourceState {
    return this.current;
  }

  is(...states: SourceState[]): boolean {
    return states.includes(this.current);
  }

  transition(to: SourceState): void {
    if (this.current === to) return;
    if (!LEGAL[this.current].has(to)) {
      throw new IllegalTransitionError(this.current, to);
    }
    this.current = to;
  }
}
