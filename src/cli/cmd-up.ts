import { Command } from "commander";
import type { UpResult } from "../proto/schema.js";
import { connectDaemon, registerProject, resolveProject, exitForProtocolError } from "./client-helpers.js";
import { log } from "../util/log.js";

interface UpOptions {
  all?: boolean;
  wait?: boolean;
  json?: boolean;
}

export function upCommand(): Command {
  return new Command("up")
    .description("Warm a source (or all)")
    .argument("[name]", "source name")
    .option("--all", "warm all sources")
    .option("--no-wait", "do not block until ready")
    .option("--json", "machine-readable output")
    .action(async (name: string | undefined, opts: UpOptions) => {
      const project = await resolveProject();
      const client = await connectDaemon();
      await registerProject(client, project).catch(exitForProtocolError);
      const target = opts.all ? undefined : name;
      const out = await client
        .request<UpResult>("up", {
          projectRoot: project.root,
          name: target,
          wait: opts.wait,
        })
        .catch(exitForProtocolError);
      if (opts.json) {
        process.stdout.write(JSON.stringify(out) + "\n");
      } else {
        if (out.started.length) log("started: " + out.started.join(", "));
        if (out.alreadyWarm.length) log("already warm: " + out.alreadyWarm.join(", "));
        for (const f of out.failed) log("failed " + f.name + ": " + f.error);
      }
      client.close();
    });
}
