import { color } from "../util/color.js";
import { log } from "../util/log.js";

/**
 * One-line render of an `UpResult.failed` entry. Used by anything that
 * surfaces start failures so the user sees identical output regardless of
 * which command they ran.
 */
export function logUpFailure(failed: { name: string; error: string }): void {
  log(
    color.red("✖ failed ") +
      color.bold(failed.name) +
      ": " +
      failed.error.split("\n")[0],
  );
}
