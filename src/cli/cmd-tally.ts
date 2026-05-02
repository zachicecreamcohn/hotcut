import { Command } from "commander";
import type { TallyResult } from "../proto/schema.js";
import { connectDaemon, registerProject, resolveProject, exitForProtocolError } from "./client-helpers.js";
import { TallyRenderer } from "./tally.js";

interface TallyOptions {
  json?: boolean;
  watch?: boolean;
}

export function tallyCommand(): Command {
  return new Command("tally")
    .description("Show source status for the current project")
    .option("--json", "machine-readable output")
    .option("-w, --watch", "re-render on change")
    .action(async (opts: TallyOptions) => {
      await runTally(opts);
    });
}

async function runTally(opts: TallyOptions): Promise<void> {
  const project = await resolveProject();
  const client = await connectDaemon();
  await registerProject(client, project).catch(exitForProtocolError);

  const fetchOnce = async (): Promise<TallyResult> => {
    return client.request<TallyResult>("tally", { projectRoot: project.root });
  };

  const renderer = new TallyRenderer();
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
