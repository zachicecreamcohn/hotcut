import { ProjectConfig } from "../config/schema.js";
import { ERROR_CODES, ProtocolError } from "../proto/errors.js";
import {
  CutParams,
  CutResult,
  DownParams,
  DownResult,
  DaemonShutdownResult,
  DaemonStatusResult,
  LogEntryDto,
  LogsParams,
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
  logsDir: string;
}

export type MethodHandler = (params: unknown) => Promise<unknown>;

export interface StreamControl {
  push: (chunk: unknown) => void;
  isCancelled: () => boolean;
  onCancel: (fn: () => void) => void;
}

export type StreamMethodHandler = (
  params: unknown,
  ctl: StreamControl,
) => Promise<void>;

export interface BuiltHandlers {
  unary: Record<string, MethodHandler>;
  stream: Record<string, StreamMethodHandler>;
}

export function buildHandlers(ctx: HandlerCtx): BuiltHandlers {
  const unary: Record<string, MethodHandler> = {
    [METHODS.status]: async (params): Promise<TallyResult> => {
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
      return { projects: runtimes.map((r) => r.status()) };
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
        logsDir: ctx.logsDir,
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

  const stream: Record<string, StreamMethodHandler> = {
    [METHODS.logs]: async (params, ctl) => {
      const p = LogsParams.parse(params);
      const r = requireProject(ctx, p.projectRoot);
      const source = r.getSource(p.name);
      if (!source) {
        throw new ProtocolError(
          ERROR_CODES.SOURCE_NOT_FOUND,
          "source not found: " + p.name,
        );
      }
      const buffer = source.logBuffer;
      const recent = buffer.recent(p.lastN);
      for (const e of recent) {
        if (ctl.isCancelled()) return;
        ctl.push(e satisfies LogEntryDto);
      }
      if (!p.follow) return;

      let resolveDone: () => void = () => {};
      const done = new Promise<void>((resolve) => {
        resolveDone = resolve;
      });
      const unsub = buffer.subscribe((entry) => {
        if (ctl.isCancelled()) return;
        ctl.push(entry satisfies LogEntryDto);
      });
      ctl.onCancel(() => {
        unsub();
        resolveDone();
      });
      await done;
    },
  };

  return { unary, stream };
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
