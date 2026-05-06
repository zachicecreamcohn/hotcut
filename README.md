# hotcut

hotcut keeps a dev server warm for every git worktree and puts a single proxy in front of them. Switching branches becomes an instant cut, not a cold restart. `localhost:8080` always points at whichever worktree is "on program."

## Why

Git worktrees are the base of my dev flow — one worktree per branch (usually `.worktree/<ticket>`), one tmux session each. To avoid juggling ports, I'd kill the dev server in one session before starting it in another. Every switch meant a cold boot, which made peeking at another branch slower than it should be.

hotcut runs a dev server for every worktree concurrently and stands a single proxy in front of them. Switching is near instant, and I never think about ports.

## Install

```sh
npm install -g hotcut
```

## Quick start

```sh
cd ~/code/my-app
hotcut init                                                # writes hotcut.toml
git worktree add .worktree/ticket-123 -b zach/ticket-123   # auto-discovered
hotcut ticket-123                                          # warms on first cut
```

Open `http://localhost:8080`.

If your dev server is slow to start, pre-warm everything:

```sh
hotcut warm-all
```

## Status

```
$ hotcut status
my-app
  worktrees
    ● ticket-123   :41000  ready    ← on program
    ○ ticket-456     —     cold
```

| glyph | state |
|---|---|
| `●` | ready |
| `◐` | warming |
| `○` | cold |
| `✖` | failed |

`hotcut status -w` watches live.

## Configuration

A minimal `hotcut.toml`:

```toml
[project]
name = "my-app"
worktree_root = ".worktree"
proxy_port = 8080
protocol = "http"             # or "https" if your dev server uses TLS

[run]
cmd = "npm start"
ready = { protocol = "http", endpoint = "/", timeout = "30s" }
warm_concurrency = 4

[env]
PORT = "$HOTCUT_PORT"
```

Each worktree gets its own port via `$HOTCUT_PORT`; the proxy at `proxy_port` routes to whichever worktree is on program. Your dev server must read its port from the env — most node frameworks already honour `PORT`, so the `[env]` mapping above is enough. If yours uses a different variable, map `$HOTCUT_PORT` onto it.

If your dev server speaks HTTPS (e.g. self-signed cert in development), set `protocol = "https"` under `[project]` so the proxy forwards to upstream over TLS. Self-signed certs on localhost are accepted.

## Setup steps

For one-shot commands that must run before anything else (e.g. `docker compose up -d`, updating keys), declare them as `[[setup]]`. They run sequentially before shared services or worktrees start.

Setup runs **once per daemon lifetime**, on the first project command after the daemon starts (`hotcut <name>`, `hotcut warm-all`, etc.). Subsequent commands against the same project-including cutting to a cold worktree-do not cause these to be re-run. A daemon restart will re-run them, though, so steps should be idempotent.

```toml
[[setup]]
name = "docker"
cmd  = "docker compose up -d"

[[setup]]
name = "certs"
cmd  = "./scripts/gen-certs.sh"
timeout = "2m"
```

| field | default | notes |
|---|---|---|
| `name` | — | required, unique per project |
| `cmd` | — | required, runs from the project root |
| `cwd` | `.` | relative to project root |
| `env` | `{}` | `$VAR` substitution from `HOTCUT_*` and the parent env |
| `timeout` | `5m` | non-zero exit or timeout aborts registration |

A failing setup step prevents the project from registering; the failing step's last log lines are surfaced in the error. Tail a step's output with `hotcut <step-name> logs`.

In status:

```
my-app
  setup
    ● docker
    ● certs
  worktrees
    ● ticket-123   :41000  ready    ← on program
```

## Shared services

For processes that aren't worktree-specific (e.g. a separate API, a background worker), declare them as `[[shared]]`. hotcut runs one of each per project, started when the project registers, stopped on `hotcut stop`. These are not touched by the `cut` command in any way.

```toml
[[shared]]
name = "stub-api"
cmd  = "node ./scripts/stub-api.js"
port = 9100
ready = { protocol = "http", endpoint = "/health", timeout = "30s" }

[[shared]]
name = "queue-worker"
cmd  = "node ./scripts/queue-worker.js"
```

| field | default | notes |
|---|---|---|
| `name` | — | required, unique per project |
| `cmd` | — | required, runs from the project root |
| `cwd` | `.` | relative to project root |
| `port` | — | when set, exposed as `PORT`/`HOTCUT_PORT` and excluded from the worktree port pool (which starts at `41000`) |
| `ready` | `{ always = true }` | or `{ protocol = "http"\|"https", endpoint = "/path", timeout, poll_interval }` (requires `port`) |
| `env` | `{}` | `$VAR` substitution from `HOTCUT_*` and the parent env |
| `shutdown_timeout` | `5s` | grace before SIGKILL |
| `restart` | `{ on_crash = true, backoff_initial = "1s", backoff_max = "30s" }` | auto-restart on unexpected exit with exponential backoff. Set `on_crash = false` to disable |

In status:

```
my-app
  shared
    ● stub-api      :9100  ready
    ● queue-worker    —    ready
  worktrees
    ● ticket-123   :41000  ready    ← on program
```

Shared services are addressable by name, just like worktrees: `hotcut <name> up`, `hotcut <name> down`, `hotcut <name> logs`.

> Manage in `[run]` what changes between branches. Manage as `[[shared]]` what doesn't.

## Shell integration

Auto-cut on tmux session change (session name = worktree name):

```tmux
set-hook -g client-session-changed 'run-shell "hotcut \"#{session_name}\" 2>/dev/null"'
```

A zsh `chpwd` hook does the same on `cd`.

Tab completion:

```sh
echo 'eval "$(hotcut completions zsh)"' >> ~/.zshrc && exec zsh
```

## Commands

```
hotcut <name>             cut to a worktree (warms if cold)
hotcut <name> up          start one worktree or shared service
hotcut <name> down        stop one worktree or shared service
hotcut <name> logs [-f]   tail logs for a worktree or shared service
hotcut status [-w]        show state; -w to watch
hotcut warm-all           pre-warm every worktree
hotcut init               write hotcut.toml
hotcut stop               stop the daemon (and everything it supervises)
```

## Contributing

PRs welcome.

## Licence

MIT.
