import { z } from "zod";
import { DEFAULTS } from "./defaults.js";
import { Duration } from "./duration.js";

const ReadyCheck = z.object({
  http: z.string().default(DEFAULTS.ready.httpPath),
  timeout: Duration.default(DEFAULTS.ready.timeout),
  poll_interval: Duration.default(DEFAULTS.ready.pollInterval),
});

/**
 * Readiness for a shared (project-scoped) service. Either:
 *  - `{ http = "/path" }` — poll http://127.0.0.1:<port><path> until 2xx-4xx
 *  - `{ always = true }`  — consider ready as soon as the process is spawned
 *
 * `http` requires `port` on the service (we need somewhere to poll).
 */
const SharedReady = z
  .union([
    z.object({
      http: z.string(),
      timeout: Duration.default(DEFAULTS.ready.timeout),
      poll_interval: Duration.default(DEFAULTS.ready.pollInterval),
    }),
    z.object({ always: z.literal(true) }),
  ])
  .default({ always: true });

const SharedService = z.object({
  name: z.string().min(1),
  cmd: z.string().min(1),
  cwd: z.string().default("."),
  port: z.number().int().min(1).max(65535).optional(),
  ready: SharedReady,
  env: z.record(z.string(), z.string()).default({}),
  shutdown_timeout: Duration.default(DEFAULTS.run.shutdownTimeout),
});
export type SharedService = z.infer<typeof SharedService>;

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
    warm_concurrency: z.number().int().min(1).default(DEFAULTS.run.warmConcurrency),
    ready: ReadyCheck.default({
      http: DEFAULTS.ready.httpPath,
      timeout: DEFAULTS.ready.timeout,
      poll_interval: DEFAULTS.ready.pollInterval,
    }),
  }),
  log: z
    .object({
      buffer_lines: z.number().int().positive().default(DEFAULTS.log.bufferLines),
    })
    .default({ buffer_lines: DEFAULTS.log.bufferLines }),
  env: z.record(z.string(), z.string()).default({}),
  discovery: z
    .object({
      include: z.array(z.string()).default(["*"]),
      exclude: z.array(z.string()).default([]),
    })
    .default({ include: ["*"], exclude: [] }),
  shared: z.array(SharedService).default([]),
}).superRefine((cfg, ctx) => {
  const seen = new Set<string>();
  for (let i = 0; i < cfg.shared.length; i++) {
    const s = cfg.shared[i]!;
    if (seen.has(s.name)) {
      ctx.addIssue({
        code: "custom",
        path: ["shared", i, "name"],
        message: "duplicate shared service name: " + s.name,
      });
    }
    seen.add(s.name);
    if ("http" in s.ready && s.port == null) {
      ctx.addIssue({
        code: "custom",
        path: ["shared", i, "ready"],
        message: "ready.http requires port on shared service " + s.name,
      });
    }
  }
});

export type ProjectConfig = z.infer<typeof ProjectConfig>;
