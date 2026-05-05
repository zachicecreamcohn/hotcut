import type { DownResult, UpResult } from "../proto/schema.js";
import { connectDaemon, registerProject, resolveProject, exitForProtocolError } from "./client-helpers.js";
import { log } from "../util/log.js";
import { color } from "../util/color.js";

export async function runNameUp(name: string): Promise<void> {
  const project = await resolveProject();
  const client = await connectDaemon();
  await registerProject(client, project).catch(exitForProtocolError);
  const out = await client
    .request<UpResult>("up", { projectRoot: project.root, name })
    .catch(exitForProtocolError);
  for (const f of out.failed) {
    log(color.red("✖ failed ") + color.bold(f.name) + ": " + f.error.split("\n")[0]);
  }
  if (out.started.length) log(color.green("✓") + " started " + color.bold(name));
  else if (out.alreadyWarm.includes(name)) log(color.dim(name + " already warm"));
  client.close();
  if (out.failed.length) process.exit(1);
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
