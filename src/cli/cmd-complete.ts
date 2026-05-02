import { Command } from "commander";

const ZSH_SCRIPT = `#compdef hotcut

_hotcut() {
  local root=\${HOTCUT_WORKTREE_ROOT:-.worktree}
  if [[ -d "\$root" ]]; then
    compadd -- \${(f)"\$(ls -1 \$root 2>/dev/null)"}
  fi
}

compdef _hotcut hotcut
`;

const BASH_SCRIPT = `_hotcut() {
  local cur root="\${HOTCUT_WORKTREE_ROOT:-.worktree}"
  cur="\${COMP_WORDS[COMP_CWORD]}"
  if [ -d "\$root" ]; then
    COMPREPLY=( \$(compgen -W "\$(ls -1 \$root 2>/dev/null)" -- "\$cur") )
  fi
}

complete -F _hotcut hotcut
`;

const FISH_SCRIPT = `complete -c hotcut -f -a "(ls -1 (set -q HOTCUT_WORKTREE_ROOT; and echo \$HOTCUT_WORKTREE_ROOT; or echo .worktree) 2>/dev/null)"
`;

export function completionsCommand(): Command {
  return new Command("completions")
    .description("Print a shell completion script (zsh, bash, fish)")
    .argument("<shell>", "zsh, bash, or fish")
    .action((shell: string) => {
      switch (shell) {
        case "zsh":
          process.stdout.write(ZSH_SCRIPT);
          return;
        case "bash":
          process.stdout.write(BASH_SCRIPT);
          return;
        case "fish":
          process.stdout.write(FISH_SCRIPT);
          return;
        default:
          process.stderr.write("[hotcut] unknown shell: " + shell + " (zsh, bash, fish)\n");
          process.exit(64);
      }
    });
}
