import type { DownResult, UpResult } from "../proto/schema.js";
import { connectDaemon, registerProject, resolveProject, exitForProtocolError } from "./client-helpers.js";
import { log } from "../util/log.js";
import { color } from "../util/color.js";
import { logUpFailure } from "./format.js";

export async function runNameUp(name: string): Promise<void> {
  const project = await resolveProject();
  const client = await connectDaemon();
  await registerProject(client, project).catch(exitForProtocolError);
  const out = await client
    .request<UpResult>("up", { projectRoot: project.root, name })
    .catch(exitForProtocolError);
  for (const f of out.failed) logUpFailure(f);
  if (out.started.length) log(color.green("✓") + " started " + color.bold(name));
  else if (out.alreadyWarm.includes(name)) log(color.dim(name + " already warm"));
  client.close();
  if (out.failed.length) process.exit(1);
}

export async function runNameLogs(name: string, opts: { follow?: boolean; json?: boolean } = {}): Promise<void> {
  // Defer to the existing logs command implementation by importing lazily;
  // avoids circular imports between cli/index.ts and cmd-logs.
  const { runLogsForName } = await import("./cmd-logs.js");
  await runLogsForName(name, opts);
}

export async function runNameDown(name: string): Promise<void> {
  const project = await resolveProject();
  const client = await connectDaemon();
  await registerProject(client, project).catch(exitForProtocolError);
  const out = await client
    .request<DownResult>("down", { projectRoot: project.root, name })
    .catch(exitForProtocolError);
  if (out.stopped.includes(name)) log(color.green("✓") + " stopped " + color.bold(name));
  else log(color.dim(name + " was not running"));
  client.close();
}
