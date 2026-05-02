import { Command } from "commander";
import type { LogEntryDto } from "../proto/schema.js";
import { connectDaemon, registerProject, resolveProject, exitForProtocolError } from "./client-helpers.js";

interface LogsOptions {
  follow?: boolean;
  json?: boolean;
}

export function logsCommand(): Command {
  return new Command("logs")
    .description("Stream a source's stdout/stderr")
    .argument("<name>", "source name (worktree)")
    .option("-f, --follow", "follow live (like tail -f)")
    .option("--json", "emit one JSON entry per line")
    .action(async (name: string, opts: LogsOptions) => {
      await runLogs(name, opts);
    });
}

async function runLogs(name: string, opts: LogsOptions): Promise<void> {
  const project = await resolveProject();
  const client = await connectDaemon();
  await registerProject(client, project).catch(exitForProtocolError);

  const stream = client.requestStream<LogEntryDto>("logs", {
    projectRoot: project.root,
    name,
    follow: opts.follow ?? false,
  });

  const onSigint = (): void => {
    stream.cancel();
  };
  process.on("SIGINT", onSigint);

  const print = (e: LogEntryDto): void => {
    if (opts.json) {
      process.stdout.write(JSON.stringify(e) + "\n");
      return;
    }
    const out = e.stream === "stderr" ? process.stderr : process.stdout;
    out.write(e.line + "\n");
  };

  try {
    for await (const entry of stream.iterator) {
      print(entry);
    }
  } catch (err) {
    process.off("SIGINT", onSigint);
    exitForProtocolError(err);
  }
  process.off("SIGINT", onSigint);
  client.close();
}
