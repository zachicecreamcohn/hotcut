import type { LogBuffer, LogStream } from "./log-buffer.js";
import type { SourceState } from "./state.js";

const ENV_VAR_PATTERN = /\$([A-Z_][A-Z0-9_]*)/g;

/**
 * Common interface for things ProjectRuntime supervises (per-worktree
 * `Source`s and project-scoped `SharedService`s). Lets `up`/`down` operate
 * over a heterogeneous list without ad-hoc shape assertions.
 */
export interface Lifecycle {
  readonly name: string;
  readonly state: SourceState;
  up(): Promise<void>;
  down(): Promise<void>;
}

/**
 * SIGTERM the leader's whole process group (created via execa's
 * `detached: true`). Falls back to direct kill if the group is gone.
 */
export function killGroup(
  pid: number | undefined,
  signal: "SIGTERM" | "SIGKILL",
): void {
  if (!pid) return;
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // already dead
    }
  }
}

/**
 * Stateful line-splitter for a child's stdout/stderr. Keeps a per-stream
 * carry buffer so partial writes don't fragment a log line.
 */
export class LineSplitter {
  private stdoutCarry = "";
  private stderrCarry = "";

  constructor(private readonly buffer: LogBuffer) {}

  feed(stream: LogStream, chunk: Buffer): void {
    const text = chunk.toString("utf8");
    const carry = stream === "stdout" ? this.stdoutCarry : this.stderrCarry;
    const combined = carry + text;
    const parts = combined.split("\n");
    const trailing = parts.pop() ?? "";
    if (stream === "stdout") this.stdoutCarry = trailing;
    else this.stderrCarry = trailing;
    for (const line of parts) this.buffer.append(stream, line);
  }
}

/**
 * Substitute `$VAR` references in user-supplied env values from the given
 * substitution table, falling back to the parent process env.
 */
export function expandEnv(
  template: Record<string, string>,
  subs: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(template)) {
    out[k] = v.replace(ENV_VAR_PATTERN, (_m, n: string) => subs[n] ?? process.env[n] ?? "");
  }
  return out;
}

/**
 * Build a one-line-plus-tail diagnostic for an unexpected child exit:
 * "<kind> <name> exited unexpectedly (code=N, signal=S). last logs: ..."
 *
 * The buffer tail gives the user something actionable in the daemon log
 * without requiring them to immediately run `hotcut logs <name>`.
 */
export function formatExitDiagnostic(
  kind: string,
  name: string,
  result: { exitCode?: number | null; signal?: string | null },
  buffer: LogBuffer,
  tailLines = 5,
): string {
  const parts: string[] = [];
  parts.push("code=" + (result.exitCode ?? "?"));
  if (result.signal) parts.push("signal=" + result.signal);
  const tail = buffer
    .recent(tailLines)
    .map((e) => "  [" + e.stream + "] " + e.line)
    .join("\n");
  const header = `${kind} ${name} exited unexpectedly (${parts.join(", ")})`;
  return tail ? header + "\nlast log lines:\n" + tail : header;
}
