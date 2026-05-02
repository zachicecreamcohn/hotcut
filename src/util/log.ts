type Stream = NodeJS.WritableStream;

export interface LineLogger {
  write(stream: "stdout" | "stderr", chunk: Buffer): void;
}

export function prefixedLogger(prefix: string): LineLogger {
  let stdoutBuf = "";
  let stderrBuf = "";

  function flush(buf: string, stream: Stream): string {
    let last = 0;
    while (true) {
      const nl = buf.indexOf("\n", last);
      if (nl === -1) break;
      stream.write(`${prefix} ${buf.slice(last, nl)}\n`);
      last = nl + 1;
    }
    return buf.slice(last);
  }

  return {
    write(stream, chunk) {
      const text = chunk.toString("utf8");
      if (stream === "stdout") {
        stdoutBuf = flush(stdoutBuf + text, process.stdout);
      } else {
        stderrBuf = flush(stderrBuf + text, process.stderr);
      }
    },
  };
}

export function log(message: string): void {
  process.stderr.write(`[hotcut] ${message}\n`);
}

export function logError(message: string, err?: unknown): void {
  if (err === undefined) {
    process.stderr.write(`[hotcut] ${message}\n`);
  } else {
    process.stderr.write(`[hotcut] ${message}: ${formatError(err)}\n`);
  }
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
