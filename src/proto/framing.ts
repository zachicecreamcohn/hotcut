const LENGTH_PREFIX = 4;
const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;

export class FramingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FramingError";
  }
}

export function encodeMessage(obj: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(obj), "utf8");
  if (json.length > MAX_MESSAGE_BYTES) {
    throw new FramingError(
      "message too large: " + json.length + " > " + MAX_MESSAGE_BYTES,
    );
  }
  const out = Buffer.alloc(LENGTH_PREFIX + json.length);
  out.writeUInt32BE(json.length, 0);
  json.copy(out, LENGTH_PREFIX);
  return out;
}

export class MessageDecoder {
  private buf: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): unknown[] {
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
    const out: unknown[] = [];
    while (true) {
      if (this.buf.length < LENGTH_PREFIX) break;
      const len = this.buf.readUInt32BE(0);
      if (len > MAX_MESSAGE_BYTES) {
        throw new FramingError(
          "incoming message too large: " + len + " > " + MAX_MESSAGE_BYTES,
        );
      }
      if (this.buf.length < LENGTH_PREFIX + len) break;
      const payload = this.buf.subarray(LENGTH_PREFIX, LENGTH_PREFIX + len);
      this.buf = this.buf.subarray(LENGTH_PREFIX + len);
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload.toString("utf8"));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new FramingError("invalid json payload: " + msg);
      }
      out.push(parsed);
    }
    return out;
  }
}

export const FRAMING_INTERNALS = {
  LENGTH_PREFIX,
  MAX_MESSAGE_BYTES,
};
