import { z } from "zod";
import { DEFAULTS } from "./defaults.js";
import { Duration } from "./duration.js";

const Protocol = z.enum(["http", "https"]).default("http");

const ReadyCheck = z.object({
  protocol: Protocol,
  endpoint: z.string().default(DEFAULTS.ready.endpoint),
  timeout: Duration.default(DEFAULTS.ready.timeout),
  poll_interval: Duration.default(DEFAULTS.ready.pollInterval),
});

/**
 * Readiness for a shared (project-scoped) service. Either:
 *  - `{ endpoint = "/path", protocol = "http" | "https" }` —
 *      poll <protocol>://127.0.0.1:<port><endpoint> until 2xx-4xx
 *  - `{ always = true }` — consider ready as soon as the process is spawned
 *
 * Endpoint readiness requires `port` on the service.
 */
const SharedReady = z
  .union([
    z.object({
      protocol: Protocol,
      endpoint: z.string(),
      timeout: Duration.default(DEFAULTS.ready.timeout),
      poll_interval: Duration.default(DEFAULTS.ready.pollInterval),
    }),
    z.object({ always: z.literal(true) }),
  ])
  .default({ always: true });

const SharedRestart = z
  .object({
    on_crash: z.boolean().default(true),
    backoff_initial: Duration.default("1s"),
    backoff_max: Duration.default("30s"),
  })
  .default({
    on_crash: true,
    backoff_initial: "1s",
    backoff_max: "30s",
  });

const SetupStep = z.object({
  name: z.string().min(1),
  cmd: z.string().min(1),
  cwd: z.string().default("."),
  env: z.record(z.string(), z.string()).default({}),
  timeout: Duration.default("5m"),
});
export type SetupStep = z.infer<typeof SetupStep>;

const SharedService = z.object({
  name: z.string().min(1),
  cmd: z.string().min(1),
  cwd: z.string().default("."),
  port: z.number().int().min(1).max(65535).optional(),
  ready: SharedReady,
  env: z.record(z.string(), z.string()).default({}),
  shutdown_timeout: Duration.default(DEFAULTS.run.shutdownTimeout),
  restart: SharedRestart,
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
      protocol: "http",
      endpoint: DEFAULTS.ready.endpoint,
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
  setup: z.array(SetupStep).default([]),
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
    if ("endpoint" in s.ready && s.port == null) {
      ctx.addIssue({
        code: "custom",
        path: ["shared", i, "ready"],
        message: "ready.endpoint requires port on shared service " + s.name,
      });
    }
  }
  const setupSeen = new Set<string>();
  for (let i = 0; i < cfg.setup.length; i++) {
    const s = cfg.setup[i]!;
    if (setupSeen.has(s.name)) {
      ctx.addIssue({
        code: "custom",
        path: ["setup", i, "name"],
        message: "duplicate setup step name: " + s.name,
      });
    }
    setupSeen.add(s.name);
  }
});

export type ProjectConfig = z.infer<typeof ProjectConfig>;
