import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { ProjectStatusDto } from "../proto/schema.js";
import { TallyRenderer } from "./tally.js";

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
      out: out as unknown as NodeJS.WritableStream,
    });
    const project: ProjectStatusDto = {
      name: "polypad",
      root: "/x",
      program: "PL-123",
      proxyPort: 8080,
      sources: [
        { name: "PL-123", state: "warm", port: 41000, onProgram: true },
        { name: "PL-456", state: "starting", port: 41001, onProgram: false },
        { name: "PL-789", state: "cold", port: null, onProgram: false },
      ],
    };

    renderer.render([project]);
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
