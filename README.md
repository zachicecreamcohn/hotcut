# hotcut

_Cut to any worktree. Live._

**hotcut** keeps a dev server running for every git worktree at the same time and puts a single proxy in front of them. Switching branches becomes an instant cut, not a cold restart. `localhost:8080` always points at whichever worktree is "on program."

## Why

Git worktrees are the base of my dev flow — one worktree per branch (usually `.worktree/<ticket>`), one tmux session each. To avoid juggling ports, I'd kill the dev server in one session before starting it in another. Every switch meant a cold boot, which made peeking at another branch slower than it should be.

hotcut keeps a dev server warm for every worktree at the same time and stands a single proxy in front of them. Switching is near instant now, and I never have to think about ports or starting/stopping servers

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

# pre-warm everything up front instead (recommended if your dev server is slow to start)
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
warm_concurrency = 4 # max worktrees warmed in parallel by `warm-all`

[env]
PORT = "$HOTCUT_PORT"
```

Each warmed worktree binds its own port (allocated by hotcut and exposed as `$HOTCUT_PORT`); the proxy at `proxy_port` then routes to whichever worktree is "on program." Your dev server must read its port from the environment; otherwise, every worktree may fight over the same port and only the first will start. Most node frameworks already honor `process.env.PORT`, so you can map it via the `[env]` block as shown.

## Shell integration

Auto-cut on tmux session change (assumes session name = worktree name):

```tmux
set-hook -g client-session-changed 'run-shell "hotcut \"#{session_name}\" 2>/dev/null"'
```

A zsh \`chpwd\` hook does the same on \`cd\`.

## Warming

`hotcut <name>` will warm a worktree on first cut if it isn't already running, then route to it instantly on subsequent cuts. If your build/start process is slow and you expect to switch around a lot, run `hotcut warm-all` up front so every worktree is ready before you start cutting.

`warm-all` warms worktrees in parallel up to `[run].warm_concurrency`

## Commands

```sh
hotcut <name>             # cut program to a worktree
hotcut <name> logs [-f]   # tail a worktree's logs
hotcut status [-w]        # see what's live (-w to watch)
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
