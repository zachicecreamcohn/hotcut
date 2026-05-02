import { Command } from "commander";
import { runDaemon } from "../daemon/daemon.js";
import { ProtocolError, ERROR_CODES } from "../proto/errors.js";
import { logError } from "../util/log.js";

export function daemonCommand(): Command {
  return new Command("daemon")
    .description("Run the daemon in foreground (for debugging)")
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
}
