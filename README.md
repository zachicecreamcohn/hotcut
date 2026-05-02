# hotcut

> Cut to any worktree. Live.

**hotcut** keeps a dev server running for every git worktree at the same time and puts a single proxy in front of them, so I can switch between branches without killing and restarting anything. It works like a TV broadcast switcher: every worktree is a live source, one of them is "on program" at any time, and a cut between them is instant.


## The problem

Git worktrees are the base of my dev flow. I work across multiple branches. Each branch gets a worktree (usually at `.worktree/<ticket-name>`) and a tmux session. When I worked on a given ticket, I would switch to that session/worktree and, in a tmux window, spin up the dev server. This worked great but to avoid keeping track of a bunch of ports and which port is associated with which branch, I would kill the server in the active session/worktree so I could then start the dev server in the branch/session/worktree I was switching to.

The kill-and-restart cycle adds up. Every switch is a cold boot, and it makes switching branches to peek at something take longer than I'd like.

## This project fixes that by making switching free and (almost) instant

The idea behind hotcut is to always be running a dev server per worktree, all of them warm at the same time, and put a stable proxy (e.g.`localhost:8080`) in front. Whichever worktree is "on program" is the one the proxy routes to. Switching is a sub-second cut, not a cold boot, and I never have to think about ports.

```sh
# the name after `hotcut` is the worktree's directory name,
# i.e. `.worktree/ticket-123` is the source `ticket-123`.
hotcut ticket-123     # cut to .worktree/ticket-123
hotcut ticket-456     # cut to .worktree/ticket-456
hotcut status     # see all live worktrees and their state
```


## Quick start

```sh
# install
npm install -g hotcut

# in your project root (the dir containing .worktree/)
hotcut init

# create worktrees as you normally do
git worktree add .worktree/ticket-123 -b zach/ticket-123

# hotcut auto-discovers them
hotcut status
# my-app
#   ○ ticket-123    —       cold
#   ○ ticket-456    —       cold
#   ○ ticket-789    —       cold

# cut to (and warm) a given worktree
hotcut ticket-123

# or...
# pre-warm everything (live status while it works)
hotcut warm-all
# my-app
#   ● ticket-123    :41001  ready    ← on program
#   ● ticket-456    :41002  ready
#   ● ticket-789    :41003  ready

# then cut between already-warm worktrees
hotcut ticket-456
hotcut ticket-123
```

Open `http://localhost:8080` in your browser. It always points at whatever's on program. Switching worktrees on the CLI = browser refresh and you're on the new branch.

## Key features

### Auto-discovery

hotcut watches `.worktree/` (configurable). Add a worktree with `git worktree add` and it appears in `hotcut status` automatically. Delete a worktree with `git worktree remove` and hotcut notices, kills its dev server, and frees the port — no orphaned processes for branches I've cleaned up.

### Lazy warm

Sources are warmed on first cut. The first `hotcut <name>` for a cold source spawns its dev server, waits for the ready check, then flips program. Subsequent cuts to a warm source are instant.

### Single stable URL

`localhost:8080` is the only URL you and your browser ever need to know. The proxy flips the upstream on every cut. Cookies, sessions, and auth all persist across cuts because the cookie domain stays stable.


### Health-checked transitions

A cut waits for the new source to report ready before flipping. Cold sources show a brief "warming up" page (~2–5s); warm sources cut instantly.

### Following hotcut to your active session

By default, hotcut doesn't auto-switch — I run `hotcut <name>` when I want to cut. If I want switching tmux sessions to also cut program, this hook does it (assumes session names match worktree directory names, e.g. `tmux new -s ticket-456` for `.worktree/ticket-456`):

```tmux
# in ~/.tmux.conf
set-hook -g client-session-changed 'run-shell "hotcut \"#{session_name}\" 2>/dev/null"'
```

> [!IMPORTANT]
> The hook passes `#{session_name}` straight to `hotcut`, so a session named `ticket-456` cuts to `.worktree/ticket-456`. If your sessions are named `myapp-ticket-456` or `1-ticket-456`, this is a no-op. Either name sessions after the worktree (`tmux new -s ticket-456`), or wrap `#{session_name}` in a `run-shell` snippet that strips your prefix.
For non-tmux flows, a zsh `chpwd` hook does the same on `cd`. See [the shell integration plan](plans/07-shell-integration.md) for bash and fish equivalents.


## How hotcut runs your dev server

hotcut spawns the dev server itself — one process per worktree — using the `[run].cmd` from `hotcut.toml`. So you don't `cd` into a worktree and `npm start` anymore; hotcut does it. Each child runs in its worktree's directory with `$PORT` set to a unique port hotcut assigns.

The processes are detached children of the hotcut daemon. Their stdout and stderr are captured into a per-source ring buffer plus a log file at `~/.local/state/hotcut/logs/<project>/<source>.log`.

To see what a source is doing:

```sh
hotcut logs ticket-123        # last 1000 lines
hotcut logs ticket-123 -f     # follow live (like tail -f)```

The "warming up" holding page in the browser tells you the source is booting; a future version will surface log lines live in that page so you can watch compile output without leaving the browser.


## Command reference

```sh
hotcut <name>             # cut program to a worktree
hotcut status [-w]        # see what's live (-w to watch)
hotcut logs <name> [-f]   # tail a source
hotcut warm-all           # pre-warm every worktree
hotcut init               # write hotcut.toml
hotcut stop               # stop the daemon (tears down everything)
```

Every command auto-starts the daemon over a Unix socket if it isn't already running.

`status` and `logs` accept `--json` for tooling. `hotcut daemon` runs the daemon in the foreground for debugging — you don't normally need it.

### Tab completion

```sh
echo 'eval "$(hotcut completions zsh)"' >> ~/.zshrc && exec zsh
```

After that, `hotcut <TAB>` lists worktrees and `hotcut foo-<TAB>` cycles through `foo-*`.

## Configuration

A single `hotcut.toml` in your project root:

```toml
[project]
name = "my-app"
worktree_root = ".worktree"
proxy_port = 8080

[run]
cmd = "npm start"
ready = { http = "/", timeout = "30s" }

[env]
PORT = "$HOTCUT_PORT"
```

That's the whole config for most projects.

## Contributions
Contributions are welcome. Feel free to make a PR.
## License

MIT.
