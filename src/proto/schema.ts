import { z } from "zod";

export const SourceStatusDto = z.object({
  name: z.string(),
  state: z.enum(["cold", "starting", "warm", "failed"]),
  port: z.number().int().nullable(),
  onProgram: z.boolean(),
});
export type SourceStatusDto = z.infer<typeof SourceStatusDto>;

export const SharedStatusDto = z.object({
  name: z.string(),
  state: z.enum(["cold", "starting", "warm", "failed"]),
  port: z.number().int().nullable(),
});
export type SharedStatusDto = z.infer<typeof SharedStatusDto>;

export const ProjectStatusDto = z.object({
  name: z.string(),
  root: z.string(),
  program: z.string().nullable(),
  proxyPort: z.number().int(),
  sources: z.array(SourceStatusDto),
  shared: z.array(SharedStatusDto).default([]),
});
export type ProjectStatusDto = z.infer<typeof ProjectStatusDto>;

export const StatusParams = z.object({
  projectRoot: z.string().optional(),
  allProjects: z.boolean().optional(),
});
export type StatusParams = z.infer<typeof StatusParams>;

export const StatusResult = z.object({
  projects: z.array(ProjectStatusDto),
});
export type StatusResult = z.infer<typeof StatusResult>;

export const CutParams = z.object({
  projectRoot: z.string(),
  name: z.string(),
  wait: z.boolean().optional(),
});
export type CutParams = z.infer<typeof CutParams>;

export const CutResult = z.object({
  program: z.string(),
  url: z.string(),
  tookMs: z.number(),
});
export type CutResult = z.infer<typeof CutResult>;

export const UpParams = z.object({
  projectRoot: z.string(),
  name: z.string().optional(),
  wait: z.boolean().optional(),
});
export type UpParams = z.infer<typeof UpParams>;

export const UpResult = z.object({
  started: z.array(z.string()),
  alreadyWarm: z.array(z.string()),
  failed: z.array(z.object({ name: z.string(), error: z.string() })).default([]),
});
export type UpResult = z.infer<typeof UpResult>;

export const DownParams = z.object({
  projectRoot: z.string(),
  name: z.string().optional(),
});
export type DownParams = z.infer<typeof DownParams>;

export const DownResult = z.object({
  stopped: z.array(z.string()),
});
export type DownResult = z.infer<typeof DownResult>;

export const RegisterParams = z.object({
  root: z.string(),
  name: z.string(),
  proxyPort: z.number().int(),
  worktreeRoot: z.string(),
  sources: z.array(z.object({ name: z.string(), worktreePath: z.string() })),
  configJson: z.string(),
});
export type RegisterParams = z.infer<typeof RegisterParams>;

export const RegisterResult = z.object({
  ok: z.literal(true),
  registered: z.boolean(),
});
export type RegisterResult = z.infer<typeof RegisterResult>;

export const DaemonShutdownParams = z.object({}).optional();
export type DaemonShutdownParams = z.infer<typeof DaemonShutdownParams>;

export const DaemonShutdownResult = z.object({ ok: z.literal(true) });
export type DaemonShutdownResult = z.infer<typeof DaemonShutdownResult>;

export const DaemonStatusParams = z.object({}).optional();
export type DaemonStatusParams = z.infer<typeof DaemonStatusParams>;

export const DaemonStatusResult = z.object({
  pid: z.number().int(),
  uptime: z.number(),
  version: z.string(),
  projects: z.number().int(),
  sources: z.number().int(),
});
export type DaemonStatusResult = z.infer<typeof DaemonStatusResult>;

export const LogEntryDto = z.object({
  ts: z.number(),
  stream: z.enum(["stdout", "stderr"]),
  line: z.string(),
});
export type LogEntryDto = z.infer<typeof LogEntryDto>;

export const LogsParams = z.object({
  projectRoot: z.string(),
  name: z.string(),
  follow: z.boolean().optional(),
  lastN: z.number().int().nonnegative().optional(),
});
export type LogsParams = z.infer<typeof LogsParams>;

export const LogsResult = LogEntryDto;
export type LogsResult = z.infer<typeof LogsResult>;

export const RequestEnvelope = z.object({
  id: z.string(),
  method: z.string(),
  params: z.unknown().optional(),
});
export type RequestEnvelope = z.infer<typeof RequestEnvelope>;

export const ResponseError = z.object({
  code: z.number().int(),
  message: z.string(),
});
export type ResponseError = z.infer<typeof ResponseError>;

export const ResponseEnvelope = z.object({
  id: z.string(),
  result: z.unknown().optional(),
  error: ResponseError.optional(),
  done: z.boolean().optional(),
});
export type ResponseEnvelope = z.infer<typeof ResponseEnvelope>;

export const METHODS = {
  status: "status",
  cut: "cut",
  up: "up",
  down: "down",
  register: "register",
  daemonShutdown: "daemon.shutdown",
  daemonStatus: "daemon.status",
  logs: "logs",
} as const;
