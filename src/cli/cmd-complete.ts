import { Command } from "commander";

const ZSH_SCRIPT = `#compdef hotcut

_hotcut_root() {
  local d=\$PWD
  while [[ "\$d" != "/" && "\$d" != "" ]]; do
    if [[ -f "\$d/hotcut.toml" ]]; then
      local wt=\$(awk -F '"' '/^[[:space:]]*worktree_root[[:space:]]*=/ {print \$2; exit}' "\$d/hotcut.toml")
      [[ -z "\$wt" ]] && wt=".worktree"
      print -- "\$d/\$wt"
      return 0
    fi
    d=\${d:h}
  done
  return 1
}

_hotcut() {
  local root
  if (( CURRENT == 2 )); then
    root=\$(_hotcut_root) || return
    [[ -d "\$root" ]] && compadd -- \${(f)"\$(ls -1 "\$root" 2>/dev/null)"}
  elif (( CURRENT == 3 )); then
    compadd -- logs
  fi
}

compdef _hotcut hotcut
`;

export function completionsCommand(): Command {
  return new Command("completions")
    .description("Print a shell completion script (zsh)")
    .argument("<shell>", "zsh")
    .action((shell: string) => {
      if (shell === "zsh") {
        process.stdout.write(ZSH_SCRIPT);
        return;
      }
      process.stderr.write("[hotcut] only zsh is supported (got: " + shell + ")\n");
      process.exit(64);
    });
}
