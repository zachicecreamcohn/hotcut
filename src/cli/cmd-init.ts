import { Command } from "commander";
import { loadConfig } from "../config/load.js";
import { discoverSources } from "../discovery/discovery.js";
import { detectProject } from "../init/detect.js";
import { writeInitConfig, ConfigExistsError } from "../init/write.js";
import { logError } from "../util/log.js";
import { color } from "../util/color.js";
import { basename } from "node:path";

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
      printCompletionHint();
      process.exit(2);
    }
    throw err;
  }
  for (const note of detection.notes) {
    process.stdout.write(color.dim(note) + "\n");
  }
  process.stdout.write(color.green("✓") + " wrote " + color.bold(path) + "\n");

  const config = await loadConfig(root);
  const sources = await discoverSources(root, config, { requireGit: true });
  process.stdout.write("\n");
  if (sources.length === 0) {
    process.stdout.write(
      color.bold("next:") + " create a worktree, then cut to it:\n" +
        color.dim("  git worktree add " + config.project.worktree_root + "/<name> -b <branch>") + "\n" +
        color.dim("  hotcut <name>") + "\n",
    );
  } else {
    process.stdout.write(color.bold("next:") + " hotcut " + color.cyan(sources[0]!.name) + "\n");
    if (sources.length > 1) {
      const others = sources.slice(1).map((s) => s.name).join(", ");
      process.stdout.write(color.dim("(also available: " + others + ")") + "\n");
    }
  }

  printCompletionHint();
}

function printCompletionHint(): void {
  if (basename(process.env.SHELL ?? "") !== "zsh") return;
  process.stdout.write(
    "\n" + color.yellow("tip:") + " enable tab-completion for worktree names with:\n" +
      color.dim("  echo 'eval \"$(hotcut completions zsh)\"' >> ~/.zshrc") + "\n",
  );
}
