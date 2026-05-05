import type { CutResult } from "../proto/schema.js";
import { connectDaemon, registerProject, resolveProject, exitForProtocolError } from "./client-helpers.js";
import { log } from "../util/log.js";
import { color } from "../util/color.js";

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
  log(
    color.green("✓") +
      " cut to " +
      color.bold(out.program) +
      " " +
      color.dim("(" + out.url + ")") +
      " " +
      color.dim("in " + out.tookMs + "ms"),
  );
  client.close();
}
