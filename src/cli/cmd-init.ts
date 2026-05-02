import { Command } from "commander";
import { loadConfig } from "../config/load.js";
import { discoverSources } from "../discovery/discovery.js";
import { detectProject } from "../init/detect.js";
import { writeInitConfig, ConfigExistsError } from "../init/write.js";
import { logError } from "../util/log.js";
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
      process.exit(2);
    }
    throw err;
  }
  for (const note of detection.notes) {
    process.stdout.write(note + "\n");
  }
  process.stdout.write("wrote " + path + "\n");

  const config = await loadConfig(root);
  const sources = await discoverSources(root, config, { requireGit: true });
  process.stdout.write("\n");
  if (sources.length === 0) {
    process.stdout.write(
      "next: create a worktree, then cut to it:\n" +
        "  git worktree add " +
        config.project.worktree_root +
        "/<name> -b <branch>\n" +
        "  hotcut <name>\n",
    );
  } else {
    process.stdout.write("next: hotcut " + sources[0]!.name + "\n");
    if (sources.length > 1) {
      const others = sources.slice(1).map((s) => s.name).join(", ");
      process.stdout.write("(also available: " + others + ")\n");
    }
  }

  printCompletionHint();
}

function printCompletionHint(): void {
  const shell = basename(process.env.SHELL ?? "");
  let cmd: string | null = null;
  if (shell === "zsh") {
    cmd = 'echo \'eval "$(hotcut completions zsh)"\' >> ~/.zshrc';
  } else if (shell === "bash") {
    cmd = 'echo \'eval "$(hotcut completions bash)"\' >> ~/.bashrc';
  } else if (shell === "fish") {
    cmd = "hotcut completions fish > ~/.config/fish/completions/hotcut.fish";
  }
  if (!cmd) return;
  process.stdout.write(
    "\ntip: enable tab-completion for worktree names with:\n" +
      "  " +
      cmd +
      "\n",
  );
}
