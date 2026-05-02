import { runDaemon } from "./daemon.js";
import { logError } from "../util/log.js";
import { ProtocolError, ERROR_CODES } from "../proto/errors.js";

runDaemon().catch((err: unknown) => {
  if (err instanceof ProtocolError && err.code === ERROR_CODES.ALREADY_RUNNING) {
    logError(err.message);
    process.exit(7);
  }
  logError("daemon failed", err);
  process.exit(1);
});
