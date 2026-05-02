import { Command } from "commander";
import { detectProject } from "../init/detect.js";
import { writeInitConfig, ConfigExistsError } from "../init/write.js";
import { logError } from "../util/log.js";

interface InitOptions {
  force?: boolean;
  json?: boolean;
}

export function initCommand(): Command {
  return new Command("init")
    .description("Detect project settings and write hotcut.toml")
    .option("--force", "overwrite existing hotcut.toml")
    .option("--json", "machine-readable output")
    .action(async (opts: InitOptions) => {
      await runInit(opts);
    });
}

async function runInit(opts: InitOptions): Promise<void> {
  const root = process.cwd();
  const detection = await detectProject(root);
  let path: string;
  try {
    path = await writeInitConfig(root, detection, { force: opts.force });
  } catch (err) {
    if (err instanceof ConfigExistsError) {
      logError(err.message);
      process.exit(2);
    }
    throw err;
  }
  if (opts.json) {
    process.stdout.write(
      JSON.stringify({
        path,
        projectName: detection.projectName,
        worktreeRoot: detection.worktreeRoot,
        proxyPort: detection.proxyPort,
        cmd: detection.cmd,
        notes: detection.notes,
      }) + "\n",
    );
    return;
  }
  for (const note of detection.notes) {
    process.stdout.write(note + "\n");
  }
  process.stdout.write(`wrote ${path}\n`);
}
