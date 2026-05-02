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
  root=\$(_hotcut_root) || return
  [[ -d "\$root" ]] && compadd -- \${(f)"\$(ls -1 "\$root" 2>/dev/null)"}
}

compdef _hotcut hotcut
`;

const BASH_SCRIPT = `_hotcut_root() {
  local d="\$PWD"
  while [ "\$d" != "/" ] && [ -n "\$d" ]; do
    if [ -f "\$d/hotcut.toml" ]; then
      local wt
      wt=\$(awk -F '"' '/^[[:space:]]*worktree_root[[:space:]]*=/ {print \$2; exit}' "\$d/hotcut.toml")
      [ -z "\$wt" ] && wt=".worktree"
      printf '%s/%s\\n' "\$d" "\$wt"
      return 0
    fi
    d=\$(dirname "\$d")
  done
  return 1
}

_hotcut() {
  local cur root
  cur="\${COMP_WORDS[COMP_CWORD]}"
  root=\$(_hotcut_root) || return
  [ -d "\$root" ] && COMPREPLY=( \$(compgen -W "\$(ls -1 "\$root" 2>/dev/null)" -- "\$cur") )
}

complete -F _hotcut hotcut
`;

const FISH_SCRIPT = `function __hotcut_root
  set -l d \$PWD
  while test "\$d" != "/" -a -n "\$d"
    if test -f "\$d/hotcut.toml"
      set -l wt (awk -F '"' '/^[[:space:]]*worktree_root[[:space:]]*=/ {print \$2; exit}' "\$d/hotcut.toml")
      test -z "\$wt"; and set wt ".worktree"
      echo "\$d/\$wt"
      return 0
    end
    set d (dirname "\$d")
  end
  return 1
end

function __hotcut_worktrees
  set -l root (__hotcut_root)
  test -n "\$root" -a -d "\$root"; and ls -1 "\$root" 2>/dev/null
end

complete -c hotcut -f -a "(__hotcut_worktrees)"
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
