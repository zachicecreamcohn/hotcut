import { Command } from "commander";
import type { DownResult } from "../proto/schema.js";
import { connectDaemon, registerProject, resolveProject, exitForProtocolError } from "./client-helpers.js";
import { log } from "../util/log.js";

interface DownOptions {
  json?: boolean;
}

export function downCommand(): Command {
  return new Command("down")
    .description("Tear down a source (or all)")
    .argument("[name]", "source name")
    .option("--json", "machine-readable output")
    .action(async (name: string | undefined, opts: DownOptions) => {
      const project = await resolveProject();
      const client = await connectDaemon();
      await registerProject(client, project).catch(exitForProtocolError);
      const out = await client
        .request<DownResult>("down", { projectRoot: project.root, name })
        .catch(exitForProtocolError);
      if (opts.json) {
        process.stdout.write(JSON.stringify(out) + "\n");
      } else if (out.stopped.length === 0) {
        log("nothing to stop");
      } else {
        log("stopped: " + out.stopped.join(", "));
      }
      client.close();
    });
}
