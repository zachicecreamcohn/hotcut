import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { FramingError, MessageDecoder, encodeMessage } from "./framing.js";

describe("framing", () => {
  it("roundtrips a single message", () => {
    const wire = encodeMessage({ hello: "world" });
    const dec = new MessageDecoder();
    const out = dec.push(wire);
    assert.deepEqual(out, [{ hello: "world" }]);
  });

  it("decodes multiple messages in one chunk", () => {
    const a = encodeMessage({ n: 1 });
    const b = encodeMessage({ n: 2 });
    const dec = new MessageDecoder();
    const out = dec.push(Buffer.concat([a, b]));
    assert.deepEqual(out, [{ n: 1 }, { n: 2 }]);
  });

  it("buffers partial messages across pushes", () => {
    const wire = encodeMessage({ chunk: true, payload: "abcdefghij" });
    const dec = new MessageDecoder();
    const mid = Math.floor(wire.length / 2);
    assert.deepEqual(dec.push(wire.subarray(0, mid)), []);
    assert.deepEqual(dec.push(wire.subarray(mid)), [
      { chunk: true, payload: "abcdefghij" },
    ]);
  });

  it("buffers a partial 4-byte length prefix", () => {
    const wire = encodeMessage({ x: 1 });
    const dec = new MessageDecoder();
    assert.deepEqual(dec.push(wire.subarray(0, 2)), []);
    assert.deepEqual(dec.push(wire.subarray(2)), [{ x: 1 }]);
  });

  it("rejects oversized declared length", () => {
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(20 * 1024 * 1024, 0);
    const dec = new MessageDecoder();
    assert.throws(() => dec.push(buf), FramingError);
  });

  it("rejects garbage json", () => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(3, 0);
    const wire = Buffer.concat([len, Buffer.from("{[}", "utf8")]);
    const dec = new MessageDecoder();
    assert.throws(() => dec.push(wire), FramingError);
  });
});
