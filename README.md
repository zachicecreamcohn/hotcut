# hotcut

hotcut keeps a development server warm for every git worktree at the same time, and puts a single proxy in front of them all. When you switch branches, the proxy cuts to the right worktree instantly — no cold restart, no juggling ports.

This page introduces hotcut, walks you through getting started, and shows how to configure it for your project.

## What hotcut does

If you use git worktrees for development, you probably have several copies of your project on disk at once — one per branch. Each copy needs its own running dev server, and only one server can listen on your "main" port (such as `localhost:8080`) at a time.

hotcut solves this in three pieces:

- **A daemon.** Runs in the background and supervises a dev server for each worktree.
- **A proxy.** Listens on a single port (`8080` by default) and forwards traffic to whichever worktree is currently "on program."
- **A CLI.** Lets you choose which worktree is on program, see what's running, tail logs, and pre-warm everything.

The result: `localhost:8080` always points at the worktree you're working on. Switching takes milliseconds.

## Before you start

You need:

- **Node.js** (any recent LTS version).
- **A git project that uses worktrees.** By convention, hotcut expects worktrees under `.worktree/` in the project root, but you can change this.
- **A dev server command** (such as `npm start` or `yarn dev`) that reads its port from the `PORT` environment variable. If your dev server hard-codes a port, every worktree will fight over the same one and only the first will start.

## Install hotcut

Install hotcut globally with npm:

```sh
npm install -g hotcut
```

This adds the `hotcut` command to your `PATH`.

## Quick start

Follow these steps to get a single worktree running.

1. Change to your project root (the directory that contains `.git/` and your worktrees).

   ```sh
   cd ~/code/my-app
   ```

2. Generate a `hotcut.toml` config file:

   ```sh
   hotcut init
   ```

   `init` detects your dev server command and writes a starting config. You can edit the file by hand later.

3. Create a worktree, if you haven't already:

   ```sh
   git worktree add .worktree/ticket-123 -b zach/ticket-123
   ```

   hotcut auto-discovers worktrees under `.worktree/`. You don't need to register them by hand.

4. Cut to the worktree:

   ```sh
   hotcut ticket-123
   ```

   The first cut warms the dev server (boots it and waits for it to be ready). Later cuts to the same worktree are instant.

5. Open `http://localhost:8080` in your browser. The proxy routes you to whichever worktree is on program.

## Pre-warm every worktree

If your dev server is slow to start and you expect to switch branches often, warm everything up front:

```sh
hotcut warm-all
```

`warm-all` boots a dev server for each worktree in parallel, up to the limit set by `warm_concurrency` in `hotcut.toml`. Once they're all warm, every `hotcut <name>` is instant.

## Check what's running

To see the state of every worktree (and any shared services — see below):

```sh
hotcut status
```

To watch the status update live, add `-w`:

```sh
hotcut status -w
```

A typical status display looks like this:

```
my-app
  worktrees
    ● ticket-123   :41000  ready    ← on program
    ○ ticket-456     —     cold
```

The glyphs mean:

| glyph | state | meaning |
|---|---|---|
| `●` | ready | dev server is warm and serving traffic |
| `◐` | warming | dev server is starting up |
| `○` | cold | not running |
| `✖` | failed | tried to warm and failed; check logs |

## Tail a worktree's logs

To see the stdout and stderr from a worktree's dev server:

```sh
hotcut logs ticket-123
```

To follow the logs as they're written (like `tail -f`), add `-f`:

```sh
hotcut logs ticket-123 -f
```

## Stop the daemon

When you're done for the day, or you want to free up resources:

```sh
hotcut stop
```

This stops the daemon, every dev server it was supervising, and any shared services.

## Configure hotcut

`hotcut init` writes a starting `hotcut.toml` for you. You can also write or edit it by hand.

### A minimal configuration

```toml
[project]
name = "my-app"
worktree_root = ".worktree"
proxy_port = 8080

[run]
cmd = "npm start"
ready = { http = "/", timeout = "30s" }
warm_concurrency = 4

[env]
PORT = "$HOTCUT_PORT"
```

### What each section does

- **`[project]`** identifies the project and tells hotcut where to find worktrees and which port the proxy should listen on.
- **`[run]`** describes the dev server that hotcut runs for each worktree:
  - `cmd` — the command to run.
  - `ready` — how hotcut decides the server is up (currently, an HTTP GET that returns 2xx–4xx).
  - `warm_concurrency` — the most worktrees `warm-all` will start at the same time.
- **`[env]`** is extra environment for each dev server. Use `$HOTCUT_PORT` to pass the per-worktree port that hotcut allocates.

> **Important:** Your dev server must read its port from the environment. Most node frameworks honour `process.env.PORT`, which is why the example sets `PORT = "$HOTCUT_PORT"`. If your dev server uses a different variable, map `$HOTCUT_PORT` onto that variable in `[env]`.

## Shared services

Sometimes a project depends on processes that aren't worktree-specific — a local job runner, a background worker, or a stub for an external dependency. You want them running, but you don't want hotcut to restart them every time you cut. And you don't want to remember to start them by hand.

Declare them as `[[shared]]` in `hotcut.toml`. hotcut runs one of each per project. The daemon starts them when the project registers, and stops them when you run `hotcut stop`. `hotcut <name>` (cut) does not touch them.

### Example

```toml
[[shared]]
name = "stub-api"
cmd  = "node ./scripts/stub-api.js"
port = 9100
ready = { http = "/health", timeout = "30s" }

[[shared]]
name = "queue-worker"
cmd  = "node ./scripts/queue-worker.js"
```

### Fields

| field | required | default | description |
|---|---|---|---|
| `name` | yes | — | unique within the project. Used to address the service in `hotcut up`, `hotcut down`, and `hotcut logs` |
| `cmd` | yes | — | shell command. Run from the project root by default |
| `cwd` | no | `.` | working directory, relative to the project root |
| `port` | no | — | if set, hotcut sets `PORT` and `HOTCUT_PORT` for the process and reserves the port so worktrees never pick it |
| `ready` | no | `{ always = true }` | how to decide the service is ready. Either `{ http = "/path" }` (requires `port`) or `{ always = true }` (consider it ready as soon as the process is spawned) |
| `env` | no | `{}` | extra environment variables. Supports `$VAR` substitution from `HOTCUT_*` and the parent environment |
| `shutdown_timeout` | no | `5s` | how long to wait after `SIGTERM` before sending `SIGKILL` |

### Where shared services appear in status

`hotcut status` groups shared services and worktrees separately:

```
my-app
  shared
    ● stub-api      :9100  ready
    ● queue-worker    —    ready
  worktrees
    ● ticket-123   :41000  ready    ← on program
    ○ ticket-456     —     cold
```

### Working with shared services

Shared services share the same commands as worktree services:

```sh
hotcut up stub-api          # start one shared service
hotcut down queue-worker    # stop one shared service
hotcut logs stub-api -f     # tail its logs
hotcut up                   # warm everything (worktrees and shared)
hotcut down                 # stop everything
```

### Choosing between shared and per-worktree

Use this rule of thumb:

> Manage in `[run]` (per-worktree) what changes when you switch branches. Manage in `[[shared]]` what stays the same across branches.

For example: if you have a service that all worktrees can talk to without modification, make it shared. If you start editing that service on a feature branch and want each worktree to run its own copy, move it back into `[run]`.

## Shell integration

You can wire hotcut into your shell or terminal so it cuts automatically.

### tmux

Cut whenever the active tmux session changes (the session name must match the worktree name):

```tmux
set-hook -g client-session-changed 'run-shell "hotcut \"#{session_name}\" 2>/dev/null"'
```

### zsh

Use a `chpwd` hook to cut whenever you `cd` into a worktree.

### Tab completion

To enable tab-completion for worktree names in zsh:

```sh
echo 'eval "$(hotcut completions zsh)"' >> ~/.zshrc && exec zsh
```

## Command reference

| command | description |
|---|---|
| `hotcut init` | detect project settings and write `hotcut.toml` |
| `hotcut <name>` | cut the program to the named worktree (warms first if needed) |
| `hotcut status [-w]` | show state of worktrees and shared services. `-w` watches live |
| `hotcut warm-all` | start a dev server for every worktree |
| `hotcut up [<name>]` | start every service (or the named one) |
| `hotcut down [<name>]` | stop every service (or the named one) |
| `hotcut logs <name> [-f]` | print logs for a worktree or shared service. `-f` follows |
| `hotcut stop` | stop the daemon and everything it was supervising |
| `hotcut completions zsh` | print a zsh completion script |

## Troubleshooting

**`hotcut <name>` says the worktree isn't found.**
Check that the worktree directory exists under your `worktree_root` (`.worktree/` by default), and that its name matches what you passed.

**The dev server warms but `localhost:8080` returns 503.**
The proxy returns `503` when nothing is on program. Run `hotcut <name>` to put a worktree on program.

**A dev server keeps failing to warm.**
Run `hotcut logs <name>` to see why. Common causes: missing `node_modules`, the server reading from a hard-coded port, or the readiness check pointing at a path that doesn't exist yet.

## Contributing

Pull requests are welcome.

## Licence

MIT.
