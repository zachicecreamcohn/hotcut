import { ProjectConfig } from "../config/schema.js";
import { ERROR_CODES, ProtocolError } from "../proto/errors.js";
import {
  CutParams,
  CutResult,
  DownParams,
  DownResult,
  DaemonShutdownResult,
  DaemonStatusResult,
  RegisterParams,
  RegisterResult,
  TallyParams,
  TallyResult,
  UpParams,
  UpResult,
  METHODS,
} from "../proto/schema.js";
import { ProjectRuntime } from "./project-runtime.js";
import type { DaemonState } from "./state.js";

export interface HandlerCtx {
  state: DaemonState;
  persist: () => Promise<void>;
  requestShutdown: () => void;
  version: string;
}

export type MethodHandler = (params: unknown) => Promise<unknown>;

export function buildHandlers(ctx: HandlerCtx): Record<string, MethodHandler> {
  return {
    [METHODS.tally]: async (params): Promise<TallyResult> => {
      const p = TallyParams.parse(params ?? {});
      let runtimes: ProjectRuntime[];
      if (p.allProjects) {
        runtimes = [...ctx.state.projects.values()];
      } else if (p.projectRoot) {
        const r = ctx.state.projects.get(p.projectRoot);
        runtimes = r ? [r] : [];
      } else {
        runtimes = [...ctx.state.projects.values()];
      }
      return { projects: runtimes.map((r) => r.tally()) };
    },

    [METHODS.cut]: async (params): Promise<CutResult> => {
      const p = CutParams.parse(params);
      const r = requireProject(ctx, p.projectRoot);
      const out = await r.cut(p.name, { wait: p.wait });
      await ctx.persist();
      return out;
    },

    [METHODS.up]: async (params): Promise<UpResult> => {
      const p = UpParams.parse(params);
      const r = requireProject(ctx, p.projectRoot);
      const out = await r.up(p.name);
      await ctx.persist();
      return out;
    },

    [METHODS.down]: async (params): Promise<DownResult> => {
      const p = DownParams.parse(params);
      const r = requireProject(ctx, p.projectRoot);
      const out = await r.down(p.name);
      await ctx.persist();
      return out;
    },

    [METHODS.register]: async (params): Promise<RegisterResult> => {
      const p = RegisterParams.parse(params);
      const existing = ctx.state.projects.get(p.root);
      if (existing) {
        for (const src of p.sources) {
          await existing.register({ name: src.name, worktreePath: src.worktreePath });
        }
        await ctx.persist();
        return { ok: true, registered: false };
      }
      let configRaw: unknown;
      try {
        configRaw = JSON.parse(p.configJson);
      } catch (err) {
        throw new ProtocolError(
          ERROR_CODES.CONFIG_INVALID,
          "config json: " + (err as Error).message,
        );
      }
      const parsed = ProjectConfig.safeParse(configRaw);
      if (!parsed.success) {
        throw new ProtocolError(
          ERROR_CODES.CONFIG_INVALID,
          "config validation: " + parsed.error.message,
        );
      }
      const runtime = new ProjectRuntime({
        root: p.root,
        config: parsed.data,
      });
      try {
        await runtime.start();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new ProtocolError(ERROR_CODES.PORT_UNAVAILABLE, "proxy port: " + msg);
      }
      for (const src of p.sources) {
        await runtime.register({ name: src.name, worktreePath: src.worktreePath });
      }
      ctx.state.projects.set(p.root, runtime);
      await ctx.persist();
      return { ok: true, registered: true };
    },

    [METHODS.daemonShutdown]: async (): Promise<DaemonShutdownResult> => {
      ctx.requestShutdown();
      return { ok: true };
    },

    [METHODS.daemonStatus]: async (): Promise<DaemonStatusResult> => {
      return {
        pid: process.pid,
        uptime: (Date.now() - ctx.state.startedAt) / 1000,
        version: ctx.version,
        projects: ctx.state.projects.size,
        sources: ctx.state.totalSources(),
      };
    },
  };
}

function requireProject(ctx: HandlerCtx, root: string): ProjectRuntime {
  const r = ctx.state.projects.get(root);
  if (!r) {
    throw new ProtocolError(
      ERROR_CODES.PROJECT_NOT_REGISTERED,
      "project not registered: " + root,
    );
  }
  return r;
}
