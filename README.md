# hotcut

> Cut to any worktree. Live.

**hotcut** keeps a dev server running for every git worktree at the same time and puts a single proxy in front of them, so I can switch between branches without killing and restarting anything. It works like a TV broadcast switcher: every worktree is a live source, one of them is on program at any time, and a cut between them is instant.


## The problem

Git worktrees are the base of my dev flow. I work across multiple branches. Each branch gets a worktree (usually at `.worktree/<ticket-name>`) and a tmux session. When I work on a given ticket, I switch to that session/worktree and, in a tmux window, spin up the dev server. This works great but to avoid keeping track of a bunch of ports and which port is associated with which branch, I kill the server in the active session/worktree so I can then start the dev server in the branch/session/worktree I'm switching to.

The kill-and-restart cycle adds up. Every switch is a cold boot, and it makes switching branches to peek at something take longer than I'd like.

## The fix

The idea behind hotcut is to run a dev server per worktree, all of them warm at the same time, and put a stable proxy (e.g.`localhost:8080`) in front. Whichever worktree is "on program" is the one the proxy routes to. Switching is a sub-second cut, not a cold boot, and I never have to think about ports.

```sh
# the name after `hotcut` is the worktree's directory name,
# i.e. `.worktree/PL-123` is the source `PL-123`.
hotcut PL-123     # cut to .worktree/PL-123
hotcut PL-456     # cut to .worktree/PL-456
hotcut tally      # see all live worktrees and their status
```

## Concepts (broadcast switcher metaphor)

| Broadcast term | hotcut meaning                                                     |
| -------------- | ------------------------------------------------------------------ |
| **Source**     | A worktree with a dev server running                               |
| **Program**    | The active source — what `localhost:8080` is currently routed to   |
| **Preview**    | A source that's warm and ready but not currently on program        |
| **Take / Cut** | Switch program to a different source (instant)                     |
| **Tally**      | Status indicator — which sources are live, warm, cold              |
| **Bus**        | The proxy that routes program to the browser                       |

## Quick start

```sh
# install
npm install -g hotcut

# in your project root (the dir containing .worktree/)
hotcut init

# create worktrees as you normally do
git worktree add .worktree/PL-123 -b zach/PL-123

# hotcut auto-discovers it
hotcut tally
# polypad
#   ● PL-123    :41001  ready    ← on program
#   ● PL-456    :41002  ready
#   ○ PL-789    —       cold

# cut between them
hotcut PL-456
```

Open `http://localhost:8080` in your browser. It always points at whatever's on program. Switching worktrees on the CLI = browser refresh and you're on the new branch.

## Key features

### Auto-discovery

hotcut watches `.worktree/` (configurable). Add a worktree with `git worktree add` and it appears in the tally automatically. Delete a worktree with `git worktree remove` and hotcut notices, kills its dev server, and frees the port — no orphaned processes for branches I've cleaned up.

### Lazy warm

Sources are warmed on first cut. The first `hotcut <name>` for a cold source spawns its dev server, waits for the ready check, then flips program. Subsequent cuts to a warm source are instant.

### Single stable URL

`localhost:8080` is the only URL you and your browser ever need to know. The proxy flips the upstream on every cut. Cookies, sessions, and auth all persist across cuts because the cookie domain stays stable.


### Health-checked transitions

A cut waits for the new source to report ready before flipping. Cold sources show a brief "warming up" page (~2–5s); warm sources cut instantly.

### Following hotcut to your active session

By default, hotcut doesn't auto-switch — I run `hotcut <name>` when I want to cut. If I want switching tmux sessions to also cut program, this hook does it (assumes session names match worktree directory names, e.g. `tmux new -s PL-456` for `.worktree/PL-456`):

```tmux
# in ~/.tmux.conf
set-hook -g client-session-changed 'run-shell "hotcut \"#{session_name}\" 2>/dev/null"'
```

> [!IMPORTANT]
> The hook passes `#{session_name}` straight to `hotcut`, so a session named `PL-456` cuts to `.worktree/PL-456`. If your sessions are named `polypad-PL-456` or `1-PL-456`, this is a no-op. Either name sessions after the worktree (`tmux new -s PL-456`), or wrap `#{session_name}` in a `run-shell` snippet that strips your prefix.

For non-tmux flows, a zsh `chpwd` hook does the same on `cd`. See [the shell integration plan](plans/07-shell-integration.md) for bash and fish equivalents.


## How hotcut runs your dev server

hotcut spawns the dev server itself — one process per worktree — using the `[run].cmd` from `hotcut.toml`. So you don't `cd` into a worktree and `npm start` anymore; hotcut does it. Each child runs in its worktree's directory with `$PORT` set to a unique port hotcut assigns.

The processes are detached children of the hotcut daemon. Their stdout and stderr are captured into a per-source ring buffer plus a log file at `~/.local/state/hotcut/logs/<project>/<source>.log`.

To see what a source is doing:

```sh
hotcut logs PL-123        # last 1000 lines
hotcut logs PL-123 -f     # follow live (like tail -f)
```

The "warming up" holding page in the browser tells you the source is booting; a future version will surface log lines live in that page so you can watch compile output without leaving the browser.

### Tradeoffs vs. running the server in tmux yourself

The console for each warm source isn't an interactive terminal — there's no TTY attached, so you can't type into it. If your dev command has a REPL or expects keyboard input ("press `r` to restart"), that doesn't work in v1. Most Node-style dev servers only emit logs, so it's fine; if your flow depends on stdin, fall back to the tmux-and-manual-restart way for that one project.

A future tmux integration (where hotcut spawns each source inside a pane it owns, so you can still `tmux attach` to inspect or interact) is on the roadmap.

## Command reference

```sh
hotcut <name>             # cut program to a worktree
hotcut tally [-w]         # see what's live (-w to watch)
hotcut logs <name> [-f]   # tail a source
hotcut init               # write hotcut.toml
hotcut stop               # stop the daemon (tears down everything)
```

Every command auto-starts the daemon over a Unix socket if it isn't already running.

`tally` and `logs` accept `--json` for tooling. `hotcut daemon` runs the daemon in the foreground for debugging — you don't normally need it.

### Tab completion

```sh
hotcut completions zsh  >> ~/.zshrc          # then: exec zsh
hotcut completions bash >> ~/.bashrc
hotcut completions fish > ~/.config/fish/completions/hotcut.fish
```

After that, `hotcut <TAB>` lists worktrees and `hotcut foo-<TAB>` cycles through `foo-*`.

## Configuration

A single `hotcut.toml` in your project root:

```toml
[project]
name = "polypad"
worktree_root = ".worktree"
proxy_port = 8080

[run]
cmd = "npm start"
ready = { http = "/", timeout = "30s" }

[env]
PORT = "$HOTCUT_PORT"
```

That's the whole config for most projects.

## Status

Pre-alpha. See [plans/](./plans) for the design and roadmap.

## License

MIT.
