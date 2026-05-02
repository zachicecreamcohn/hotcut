import { z } from "zod";
import { DEFAULTS } from "./defaults.js";
import { Duration } from "./duration.js";

const ReadyCheck = z.object({
  http: z.string().default(DEFAULTS.ready.httpPath),
  timeout: Duration.default(DEFAULTS.ready.timeout),
  poll_interval: Duration.default(DEFAULTS.ready.pollInterval),
});

export const ProjectConfig = z.object({
  project: z.object({
    name: z.string().min(1),
    worktree_root: z.string().default(DEFAULTS.worktreeRoot),
    proxy_port: z.number().int().min(1).max(65535).default(DEFAULTS.proxyPort),
  }),
  run: z.object({
    cmd: z.string().min(1),
    shutdown_timeout: Duration.default(DEFAULTS.run.shutdownTimeout),
    restart_on_crash: z.boolean().default(DEFAULTS.run.restartOnCrash),
    ready: ReadyCheck.default({
      http: DEFAULTS.ready.httpPath,
      timeout: DEFAULTS.ready.timeout,
      poll_interval: DEFAULTS.ready.pollInterval,
    }),
  }),
  env: z.record(z.string(), z.string()).default({}),
});

export type ProjectConfig = z.infer<typeof ProjectConfig>;
