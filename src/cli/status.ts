import type {
  ProjectStatusDto,
  SharedStatusDto,
  SourceStatusDto,
} from "../proto/schema.js";
import { color } from "../util/color.js";

const STATE_GLYPH: Record<SourceStatusDto["state"], string> = {
  cold: color.gray("○"),
  starting: color.yellow("◐"),
  warm: color.green("●"),
  failed: color.red("✖"),
};

const STATE_LABEL: Record<SourceStatusDto["state"], string> = {
  cold: color.gray("cold".padEnd(8)),
  starting: color.yellow("warming".padEnd(8)),
  warm: color.green("ready".padEnd(8)),
  failed: color.red("failed".padEnd(8)),
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
      lines.push(color.dim("(no projects registered)"));
    }
    for (const p of projects) {
      lines.push(color.bold(p.name));
      if (p.shared && p.shared.length > 0) {
        lines.push("  " + color.dim("shared"));
        const sharedWidth = p.shared.reduce((m, s) => Math.max(m, s.name.length), 0);
        for (const s of p.shared) {
          lines.push(renderShared(s, sharedWidth));
        }
      }
      lines.push("  " + color.dim("worktrees"));
      if (p.sources.length === 0) {
        lines.push("    " + color.dim("(none)"));
      } else {
        const nameWidth = p.sources.reduce((m, s) => Math.max(m, s.name.length), 0);
        for (const s of p.sources) {
          const glyph = STATE_GLYPH[s.state];
          const label = STATE_LABEL[s.state];
          const portRaw = s.port == null ? "—" : ":" + s.port;
          const port = color.dim(portRaw.padStart(7));
          const name = s.onProgram
            ? color.cyan(s.name.padEnd(nameWidth))
            : s.name.padEnd(nameWidth);
          const arrow = s.onProgram ? "  " + color.cyan("← on program") : "";
          lines.push("    " + glyph + " " + name + " " + port + " " + label + arrow);
        }
      }
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

function renderShared(s: SharedStatusDto, nameWidth: number): string {
  const glyph = STATE_GLYPH[s.state];
  const label = STATE_LABEL[s.state];
  const portRaw = s.port == null ? "—" : ":" + s.port;
  const port = color.dim(portRaw.padStart(7));
  return "    " + glyph + " " + s.name.padEnd(nameWidth) + " " + port + " " + label;
}
