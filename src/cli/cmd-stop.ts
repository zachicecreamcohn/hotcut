import { Command } from "commander";
import { DaemonClient } from "../daemon/client.js";
import { resolveStatePaths } from "../state/paths.js";
import { isAlive, readPidFile } from "../state/pid.js";
import { log, logError } from "../util/log.js";
import { color } from "../util/color.js";

export function stopCommand(): Command {
  return new Command("stop")
    .description("Stop the daemon (tears down all sources)")
    .action(async () => {
      const paths = resolveStatePaths();
      const pid = await readPidFile(paths.pidPath);
      if (pid === null || !isAlive(pid)) {
        log(color.dim("daemon not running"));
        return;
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
          log(color.green("✓") + " daemon stopped");
          return;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      logError("daemon pid " + pid + " did not exit within 5s");
      process.exit(1);
    });
}
