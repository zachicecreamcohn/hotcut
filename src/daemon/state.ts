import type { PersistedProject, PersistedState } from "../state/state-file.js";
import { ProjectRuntime } from "./project-runtime.js";

export class DaemonState {
  readonly projects = new Map<string, ProjectRuntime>();
  readonly startedAt = Date.now();
  shuttingDown = false;

  toPersisted(): PersistedState {
    const projects: PersistedProject[] = [];
    for (const r of this.projects.values()) {
      projects.push({
        root: r.root,
        name: r.name,
        proxyPort: r.proxyPort,
        worktreeRoot: r.config.project.worktree_root,
        sources: r.sourcePorts(),
      });
    }
    return { version: 1, projects };
  }

  totalSources(): number {
    let n = 0;
    for (const r of this.projects.values()) n += r.listSourceNames().length;
    return n;
  }
}
