// Force colour off so assertions are stable regardless of whether the test
// runner is attached to a TTY. Must run before picocolors is imported.
process.env.NO_COLOR = "1";

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { ProjectStatusDto } from "../proto/schema.js";
import { StatusRenderer } from "./status.js";

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

describe("StatusRenderer", () => {
  it("renders a header and one line per source", () => {
    const out = new CapturingStream();
    const renderer = new StatusRenderer({
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
    // header + worktrees-subheader + 3 sources
    assert.equal(lines.length, 5);
    assert.equal(lines[0], "polypad");
    assert.match(lines[1]!, /worktrees/);
    assert.match(lines[2]!, /PL-123/);
    assert.match(lines[2]!, /on program/);
    assert.match(lines[3]!, /warming/);
    assert.match(lines[4]!, /cold/);
    assert.match(lines[4]!, /—/);
  });

  it("renders a 'shared:' section when shared services are present", () => {
    const out = new CapturingStream();
    const renderer = new StatusRenderer({
      out: out as unknown as NodeJS.WritableStream,
    });
    const project: ProjectStatusDto = {
      name: "polypad",
      root: "/x",
      program: null,
      proxyPort: 8080,
      sources: [
        { name: "PL-123", state: "cold", port: null, onProgram: false },
      ],
      shared: [
        { name: "tts", state: "warm", port: 8081 },
        { name: "temporal", state: "warm", port: null },
      ],
    };

    renderer.render([project]);
    const lines = out.text.split("\n").filter(Boolean);
    // header + shared subheader + 2 shared + worktrees subheader + 1 source
    assert.equal(lines.length, 6);
    assert.equal(lines[0], "polypad");
    assert.match(lines[1]!, /shared/);
    assert.match(lines[2]!, /tts/);
    assert.match(lines[2]!, /:8081/);
    assert.match(lines[2]!, /ready/);
    assert.match(lines[3]!, /temporal/);
    assert.match(lines[3]!, /—/);
    assert.match(lines[4]!, /worktrees/);
    assert.match(lines[5]!, /PL-123/);
  });

  it("omits the shared section when there are no shared services", () => {
    const out = new CapturingStream();
    const renderer = new StatusRenderer({
      out: out as unknown as NodeJS.WritableStream,
    });
    renderer.render([
      {
        name: "p",
        root: "/x",
        program: null,
        proxyPort: 8080,
        sources: [{ name: "a", state: "cold", port: null, onProgram: false }],
        shared: [],
      },
    ]);
    const text = out.text;
    assert.ok(!/^\s*shared\s*$/m.test(text));
  });

  it("renders a (none) placeholder when there are no worktrees", () => {
    const out = new CapturingStream();
    const renderer = new StatusRenderer({
      out: out as unknown as NodeJS.WritableStream,
    });
    renderer.render([
      {
        name: "p",
        root: "/x",
        program: null,
        proxyPort: 8080,
        sources: [],
        shared: [{ name: "stub", state: "warm", port: 9100 }],
      },
    ]);
    const text = out.text;
    assert.match(text, /worktrees/);
    assert.match(text, /\(none\)/);
  });
});
