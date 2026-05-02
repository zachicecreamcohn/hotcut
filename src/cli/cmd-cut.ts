import type { CutResult } from "../proto/schema.js";
import { connectDaemon, registerProject, resolveProject, exitForProtocolError } from "./client-helpers.js";
import { log } from "../util/log.js";

export async function runCut(name: string): Promise<void> {
  const project = await resolveProject();
  const client = await connectDaemon();
  await registerProject(client, project).catch(exitForProtocolError);
  const out = await client
    .request<CutResult>("cut", {
      projectRoot: project.root,
      name,
    })
    .catch(exitForProtocolError);
  log("cut to " + out.program + " (" + out.url + ") in " + out.tookMs + "ms");
  client.close();
}
