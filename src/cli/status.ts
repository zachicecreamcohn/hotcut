import type { ProjectStatusDto, SourceStatusDto } from "../proto/schema.js";

const STATE_GLYPH: Record<SourceStatusDto["state"], string> = {
  cold: "○",
  starting: "◐",
  warm: "●",
  failed: "✖",
};

const STATE_LABEL: Record<SourceStatusDto["state"], string> = {
  cold: "cold",
  starting: "warming",
  warm: "ready",
  failed: "failed",
};

export interface StatusRendererOpts {
  out?: NodeJS.WritableStream;
}

/**
 * Renders a project status DTO (as returned by the daemon) to a stream.
 * Slice 3+ no longer redraws — every render is a fresh write. Callers wanting
 * live updates poll the daemon and re-render.
 */
export class StatusRenderer {
  private readonly out: NodeJS.WritableStream;
  private readonly isTty: boolean;
  private lastLines = 0;

  constructor(opts: StatusRendererOpts = {}) {
    this.out = opts.out ?? process.stderr;
    this.isTty = (this.out as NodeJS.WriteStream).isTTY === true;
  }

  render(projects: readonly ProjectStatusDto[]): void {
    if (this.isTty) this.eraseLast();
    const lines: string[] = [];
    if (projects.length === 0) {
      lines.push("(no projects registered)");
    }
    for (const p of projects) {
      lines.push(p.name);
      const nameWidth = p.sources.reduce((m, s) => Math.max(m, s.name.length), 0);
      p.sources.forEach((s, i) => {
        const idx = String(i + 1).padStart(2);
        const glyph = STATE_GLYPH[s.state];
        const label = STATE_LABEL[s.state];
        const port = s.port == null ? "—" : ":" + s.port;
        const arrow = s.onProgram ? "  ← on program" : "";
        lines.push(
          "  " + idx + ") " + glyph + " " + s.name.padEnd(nameWidth) + " " + port.padStart(7) + " " + label.padEnd(8) + arrow,
        );
      });
    }
    for (const l of lines) this.out.write(l + "\n");
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
}
