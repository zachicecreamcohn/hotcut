import type { Bus } from "../bus/bus.js";
import type { Source } from "../supervisor/source.js";
import type { SourceState } from "../supervisor/state.js";

const STATE_GLYPH: Record<SourceState, string> = {
  cold: "○",
  starting: "◐",
  warm: "●",
  failed: "✖",
};

const STATE_LABEL: Record<SourceState, string> = {
  cold: "cold",
  starting: "warming",
  warm: "ready",
  failed: "failed",
};

export interface TallyOpts {
  projectName: string;
  out?: NodeJS.WritableStream;
}

/**
 * Renders a live status table to stderr.
 * Call .render() to draw, .clear() before printing other output.
 */
export class TallyRenderer {
  private readonly out: NodeJS.WritableStream;
  private readonly projectName: string;
  private lastLines = 0;
  private readonly isTty: boolean;

  constructor(opts: TallyOpts) {
    this.out = opts.out ?? process.stderr;
    this.projectName = opts.projectName;
    this.isTty = (this.out as NodeJS.WriteStream).isTTY === true;
  }

  render(sources: readonly Source[], bus: Bus): void {
    if (this.isTty) this.eraseLast();
    const lines = this.format(sources, bus);
    for (const l of lines) this.out.write(`${l}\n`);
    this.lastLines = this.isTty ? lines.length : 0;
  }

  clear(): void {
    if (!this.isTty) return;
    this.eraseLast();
    this.lastLines = 0;
  }

  private eraseLast(): void {
    for (let i = 0; i < this.lastLines; i++) {
      this.out.write("\x1b[1A\x1b[2K");
    }
  }

  private format(sources: readonly Source[], bus: Bus): string[] {
    const program = bus.programName();
    const lines: string[] = [this.projectName];
    sources.forEach((s, i) => {
      const onProgram = s.name === program;
      const idx = String(i + 1).padStart(2);
      const glyph = STATE_GLYPH[s.state];
      const label = STATE_LABEL[s.state];
      const port = s.state === "cold" ? "—" : `:${s.port}`;
      const arrow = onProgram ? "  ← on program" : "";
      lines.push(
        `  ${idx}) ${glyph} ${s.name.padEnd(10)} ${port.padEnd(7)} ${label.padEnd(8)}${arrow}`,
      );
    });
    return lines;
  }
}
