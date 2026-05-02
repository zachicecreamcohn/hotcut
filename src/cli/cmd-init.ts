import { Command } from "commander";
import { detectProject } from "../init/detect.js";
import { writeInitConfig, ConfigExistsError } from "../init/write.js";
import { logError } from "../util/log.js";

export function initCommand(): Command {
  return new Command("init")
    .description("Detect project settings and write hotcut.toml")
    .action(async () => {
      await runInit();
    });
}

async function runInit(): Promise<void> {
  const root = process.cwd();
  const detection = await detectProject(root);
  let path: string;
  try {
    path = await writeInitConfig(root, detection);
  } catch (err) {
    if (err instanceof ConfigExistsError) {
      logError(err.message);
      process.exit(2);
    }
    throw err;
  }
  for (const note of detection.notes) {
    process.stdout.write(note + "\n");
  }
  process.stdout.write("wrote " + path + "\n");
}
