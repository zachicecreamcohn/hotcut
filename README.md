# hotcut

_Cut to any worktree. Live._

**hotcut** keeps a dev server running for every git worktree at the same time and puts a single proxy in front of them. Switching branches becomes an instant cut, not a cold restart. `localhost:8080` always points at whichever worktree is "on program."

## Install

```sh
npm install -g hotcut
```

## Use

```sh
# in your project root (containing .worktree/)
hotcut init

# create worktrees as you normally do; hotcut auto-discovers them
git worktree add .worktree/ticket-123 -b zach/ticket-123

# cut to a worktree (warms it on first cut, instant after)
hotcut ticket-123

# pre-warm everything up front instead
hotcut warm-all

# see what's live
hotcut status
```

Open `http://localhost:8080` (proxy for dev servers running in each worktree)

## Config

A single `hotcut.toml` in your project root:

```toml
[project]
name = "my-app"
worktree_root = ".worktree"
proxy_port = 8080

[run]
cmd = "npm start" # this is run to "warm" a worktree
ready = { http = "/", timeout = "30s" }

[env]
PORT = "$HOTCUT_PORT"
```

## Shell integration

Auto-cut on tmux session change (assumes session name = worktree name):

```tmux
set-hook -g client-session-changed 'run-shell "hotcut \"#{session_name}\" 2>/dev/null"'
```

A zsh \`chpwd\` hook does the same on \`cd\`.

## Commands

```sh
hotcut <name>             # cut program to a worktree
hotcut status [-w]        # see what's live (-w to watch)
hotcut logs <name> [-f]   # tail a source
hotcut warm-all           # pre-warm every worktree
hotcut init               # write hotcut.toml
hotcut stop               # stop the daemon
```

### Tab completion

```sh
echo 'eval "\$(hotcut completions zsh)"' >> ~/.zshrc && exec zsh
```

## Contributing

PRs welcome.

## License

MIT.
