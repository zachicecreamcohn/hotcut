import type { ReadStream } from "node:tty";

export type KeyHandler = (key: string) => void | Promise<void>;

export interface KeypressInput {
  start: () => void;
  stop: () => void;
}

/**
 * Reads single keys from stdin in raw mode and dispatches to the handler.
 * Treats Ctrl-C / Ctrl-D as quit signals (handler receives "quit").
 *
 * No-op on non-TTY stdin (e.g. piped input). Caller should fall back to
 * SIGINT-driven shutdown in that case.
 */
export function startKeypress(handler: KeyHandler): KeypressInput {
  const input = process.stdin as ReadStream;
  if (!input.isTTY) {
    return { start: () => {}, stop: () => {} };
  }

  const onData = (chunk: Buffer) => {
    const s = chunk.toString("utf8");
    if (s === "\u0003" || s === "\u0004") {
      void handler("quit");
      return;
    }
    void handler(s);
  };

  return {
    start: () => {
      input.setRawMode(true);
      input.resume();
      input.setEncoding("utf8");
      input.on("data", onData);
    },
    stop: () => {
      input.off("data", onData);
      if (input.isTTY) input.setRawMode(false);
      input.pause();
    },
  };
}
