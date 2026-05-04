import { Command } from "commander";
import type { StatusResult } from "../proto/schema.js";
import { connectDaemon, registerProject, resolveProject, exitForProtocolError } from "./client-helpers.js";
import { StatusRenderer } from "./status.js";

interface StatusOptions {
  json?: boolean;
  watch?: boolean;
}

export function statusCommand(): Command {
  return new Command("status")
    .description("Show source status for the current project")
    .option("--json", "machine-readable output")
    .option("-w, --watch", "re-render on change")
    .action(async (opts: StatusOptions) => {
      await runStatus(opts);
    });
}

async function runStatus(opts: StatusOptions): Promise<void> {
  const project = await resolveProject();
  const client = await connectDaemon();
  await registerProject(client, project).catch(exitForProtocolError);

  const fetchOnce = async (): Promise<StatusResult> => {
    return client.request<StatusResult>("status", { projectRoot: project.root });
  };

  const renderer = new StatusRenderer();
  const renderOnce = async (): Promise<void> => {
    const t = await fetchOnce().catch(exitForProtocolError);
    if (opts.json) {
      process.stdout.write(JSON.stringify(t) + "\n");
    } else {
      renderer.render(t.projects);
    }
  };

  if (!opts.watch) {
    await renderOnce();
    client.close();
    return;
  }

  await renderOnce();
  const timer = setInterval(() => {
    void renderOnce();
  }, 1000);
  process.on("SIGINT", () => {
    clearInterval(timer);
    client.close();
    process.exit(0);
  });
}
