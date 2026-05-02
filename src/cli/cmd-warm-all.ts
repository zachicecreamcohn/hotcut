import { Command } from "commander";
import type { UpResult } from "../proto/schema.js";
import { connectDaemon, registerProject, resolveProject, exitForProtocolError } from "./client-helpers.js";
import { log } from "../util/log.js";

export function warmAllCommand(): Command {
  return new Command("warm-all")
    .description("Pre-warm every worktree's dev server")
    .action(async () => {
      const project = await resolveProject();
      const client = await connectDaemon();
      await registerProject(client, project).catch(exitForProtocolError);
      const out = await client
        .request<UpResult>("up", { projectRoot: project.root })
        .catch(exitForProtocolError);
      if (out.started.length) log("started: " + out.started.join(", "));
      if (out.alreadyWarm.length) log("already warm: " + out.alreadyWarm.join(", "));
      for (const f of out.failed) log("failed " + f.name + ": " + f.error);
      client.close();
      if (out.failed.length) process.exit(1);
    });
}
