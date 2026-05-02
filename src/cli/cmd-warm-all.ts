import { Command } from "commander";
import type { TallyResult, UpResult } from "../proto/schema.js";
import { connectDaemon, registerProject, resolveProject, exitForProtocolError } from "./client-helpers.js";
import { TallyRenderer } from "./tally.js";
import { log } from "../util/log.js";

export function warmAllCommand(): Command {
  return new Command("warm-all")
    .description("Pre-warm every worktree's dev server (live status)")
    .action(async () => {
      const project = await resolveProject();
      const client = await connectDaemon();
      await registerProject(client, project).catch(exitForProtocolError);

      const renderer = new TallyRenderer();
      const fetchStatus = (): Promise<TallyResult> =>
        client.request<TallyResult>("status", { projectRoot: project.root });

      const upPromise = client
        .request<UpResult>("up", { projectRoot: project.root })
        .catch(exitForProtocolError) as Promise<UpResult>;

      let stop = false;
      const settled = (t: TallyResult): boolean =>
        t.projects.every((p) =>
          p.sources.every((s) => s.state === "warm" || s.state === "failed" || s.state === "cold"),
        );
      const inFlight = (t: TallyResult): boolean =>
        t.projects.some((p) => p.sources.some((s) => s.state === "starting"));

      const loop = async (): Promise<void> => {
        while (!stop) {
          const t = await fetchStatus().catch(() => null);
          if (t) renderer.render(t.projects);
          if (t && settled(t) && !inFlight(t)) return;
          await new Promise((r) => setTimeout(r, 400));
        }
      };

      const loopPromise = loop();
      const result = await upPromise;
      stop = true;
      await loopPromise;

      for (const f of result.failed) {
        log("failed " + f.name + ": " + f.error.split("\n")[0]);
      }
      client.close();
      if (result.failed.length) process.exit(1);
    });
}
