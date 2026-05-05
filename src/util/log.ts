import { color } from "./color.js";

const PREFIX = color.dim("[hotcut]");
const ERR_PREFIX = color.red("[hotcut]");

export function log(message: string): void {
  process.stderr.write(PREFIX + " " + message + "\n");
}

export function logError(message: string, err?: unknown): void {
  if (err === undefined) {
    process.stderr.write(ERR_PREFIX + " " + color.red(message) + "\n");
  } else {
    process.stderr.write(ERR_PREFIX + " " + color.red(message) + ": " + formatError(err) + "\n");
  }
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
