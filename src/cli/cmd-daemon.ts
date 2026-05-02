import { Command } from "commander";
import { runDaemon } from "../daemon/daemon.js";
import { ensureDaemon, DaemonStartError } from "../daemon/auto-start.js";
import { DaemonClient } from "../daemon/client.js";
import { resolveStatePaths } from "../state/paths.js";
import { isAlive, readPidFile } from "../state/pid.js";
import { ProtocolError, ERROR_CODES } from "../proto/errors.js";
import { log, logError } from "../util/log.js";
import type { DaemonStatusResult } from "../proto/schema.js";

export function daemonCommand(): Command {
  const cmd = new Command("daemon")
    .description("Run the daemon in foreground (default), or manage it")
    .action(async () => {
      try {
        await runDaemon();
      } catch (err) {
        if (err instanceof ProtocolError && err.code === ERROR_CODES.ALREADY_RUNNING) {
          logError(err.message);
          process.exit(7);
        }
        logError("daemon failed", err);
        process.exit(1);
      }
    });

  cmd
    .command("status")
    .description("Show daemon liveness and version")
    .action(async () => {
      const paths = resolveStatePaths();
      const pid = await readPidFile(paths.pidPath);
      if (pid === null || !isAlive(pid)) {
        log("daemon not running");
        process.exit(0);
      }
      const client = new DaemonClient(paths.sockPath);
      try {
        await client.connect();
      } catch {
        log("pid " + pid + " alive but socket not accepting at " + paths.sockPath);
        process.exit(1);
      }
      const r = await client.request<DaemonStatusResult>("daemon.status");
      log(
        "pid=" + r.pid + " uptime=" + r.uptime.toFixed(1) + "s version=" + r.version + " projects=" + r.projects + " sources=" + r.sources,
      );
      client.close();
    });

  cmd
    .command("stop")
    .description("Tell the daemon to shut down")
    .action(async () => {
      const paths = resolveStatePaths();
      const pid = await readPidFile(paths.pidPath);
      if (pid === null || !isAlive(pid)) {
        log("daemon not running");
        process.exit(0);
      }
      const client = new DaemonClient(paths.sockPath);
      try {
        await client.connect();
      } catch (err) {
        logError("could not connect to daemon socket", err);
        process.exit(1);
      }
      try {
        await client.request("daemon.shutdown");
      } catch (err) {
        if (!(err instanceof Error && /closed/.test(err.message))) throw err;
      }
      client.close();
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (!isAlive(pid)) {
          log("daemon stopped");
          return;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      logError("daemon pid " + pid + " did not exit within 5s");
      process.exit(1);
    });

  cmd
    .command("restart")
    .description("Stop and re-start the daemon")
    .action(async () => {
      const paths = resolveStatePaths();
      const pid = await readPidFile(paths.pidPath);
      if (pid !== null && isAlive(pid)) {
        const client = new DaemonClient(paths.sockPath);
        try {
          await client.connect();
          await client.request("daemon.shutdown").catch(() => {});
        } catch {
          // skip
        }
        client.close();
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline && isAlive(pid)) {
          await new Promise((r) => setTimeout(r, 50));
        }
      }
      try {
        const c = await ensureDaemon();
        c.close();
        log("daemon restarted");
      } catch (err) {
        if (err instanceof DaemonStartError) {
          logError(err.message);
          process.exit(3);
        }
        throw err;
      }
    });

  return cmd;
}
