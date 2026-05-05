import { Command } from "commander";
import type { StatusResult, UpResult } from "../proto/schema.js";
import { connectDaemon, registerProject, resolveProject, exitForProtocolError } from "./client-helpers.js";
import { StatusRenderer } from "./status.js";
import { log } from "../util/log.js";
import { color } from "../util/color.js";

export function warmAllCommand(): Command {
  return new Command("warm-all")
    .description("Pre-warm every worktree's dev server (live status)")
    .action(async () => {
      const project = await resolveProject();
      const client = await connectDaemon();
      await registerProject(client, project).catch(exitForProtocolError);

      const renderer = new StatusRenderer();
      const fetchStatus = (): Promise<StatusResult> =>
        client.request<StatusResult>("status", { projectRoot: project.root });

      // Render the initial cold state immediately so the user sees the list
      // before warming begins. Otherwise nothing is printed until the first
      // poll fires (~400ms in).
      const initial = await fetchStatus().catch(() => null);
      if (initial) renderer.render(initial.projects);

      const upPromise = client
        .request<UpResult>("up", { projectRoot: project.root })
        .catch(exitForProtocolError) as Promise<UpResult>;

      let stop = false;
      const settled = (t: StatusResult): boolean =>
        t.projects.every((p) =>
          p.sources.every((s) => s.state === "warm" || s.state === "failed" || s.state === "cold"),
        );
      const inFlight = (t: StatusResult): boolean =>
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

      // After `up` resolves, fetch and render one final time so the user sees
      // the terminal state of every source (the polling loop may have exited
      // mid-sleep, missing the last transition).
      const final = await fetchStatus().catch(() => null);
      if (final) renderer.render(final.projects);

      for (const f of result.failed) {
        log(color.red("✖ failed ") + color.bold(f.name) + ": " + f.error.split("\n")[0]);
      }
      client.close();
      if (result.failed.length) process.exit(1);
    });
}
