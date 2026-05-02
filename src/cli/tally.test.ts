import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { Bus } from "../bus/bus.js";
import type { Source } from "../supervisor/source.js";
import type { SourceState } from "../supervisor/state.js";
import { TallyRenderer } from "./tally.js";

function fakeSource(name: string, state: SourceState, port: number): Source {
  return { name, port, state } as unknown as Source;
}

class CapturingStream {
  chunks: string[] = [];
  isTTY = false;
  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }
  get text(): string {
    return this.chunks.join("");
  }
}

describe("TallyRenderer", () => {
  it("renders a header and one line per source", () => {
    const out = new CapturingStream();
    const renderer = new TallyRenderer({
      projectName: "polypad",
      out: out as unknown as NodeJS.WritableStream,
    });
    const bus = new Bus();
    const sources = [
      fakeSource("PL-123", "warm", 41000),
      fakeSource("PL-456", "starting", 41001),
      fakeSource("PL-789", "cold", 0),
    ];
    bus.cut(sources[0]!);

    renderer.render(sources, bus);
    const lines = out.text.split("\n").filter(Boolean);
    assert.equal(lines.length, 4); // header + 3 sources
    assert.equal(lines[0], "polypad");
    assert.match(lines[1]!, /PL-123/);
    assert.match(lines[1]!, /on program/);
    assert.match(lines[2]!, /warming/);
    assert.match(lines[3]!, /cold/);
    assert.match(lines[3]!, /—/);
  });
});
