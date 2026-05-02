export function log(message: string): void {
  process.stderr.write("[hotcut] " + message + "\n");
}

export function logError(message: string, err?: unknown): void {
  if (err === undefined) {
    process.stderr.write("[hotcut] " + message + "\n");
  } else {
    process.stderr.write("[hotcut] " + message + ": " + formatError(err) + "\n");
  }
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
