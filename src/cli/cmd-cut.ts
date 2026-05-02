import type { CutResult } from "../proto/schema.js";
import { connectDaemon, registerProject, resolveProject, exitForProtocolError } from "./client-helpers.js";
import { log } from "../util/log.js";

export interface CutCliOptions {
  json?: boolean;
  wait?: boolean;
}

export async function runCut(name: string, opts: CutCliOptions = {}): Promise<void> {
  const project = await resolveProject();
  const client = await connectDaemon();
  await registerProject(client, project).catch(exitForProtocolError);
  const out = await client
    .request<CutResult>("cut", {
      projectRoot: project.root,
      name,
      wait: opts.wait,
    })
    .catch(exitForProtocolError);
  if (opts.json) {
    process.stdout.write(JSON.stringify(out) + "\n");
  } else {
    log("cut to " + out.program + " (" + out.url + ") in " + out.tookMs + "ms");
  }
  client.close();
}
