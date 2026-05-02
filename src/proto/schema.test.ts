import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  CutParams,
  RegisterParams,
  RequestEnvelope,
  ResponseEnvelope,
  TallyResult,
} from "./schema.js";

describe("proto schema", () => {
  it("validates a request envelope", () => {
    const r = RequestEnvelope.parse({ id: "abc", method: "tally" });
    assert.equal(r.id, "abc");
    assert.equal(r.method, "tally");
  });

  it("rejects a request without id", () => {
    assert.throws(() => RequestEnvelope.parse({ method: "tally" }));
  });

  it("validates a successful response envelope", () => {
    const r = ResponseEnvelope.parse({ id: "abc", result: { ok: true } });
    assert.equal(r.id, "abc");
  });

  it("validates an error response envelope", () => {
    const r = ResponseEnvelope.parse({
      id: "abc",
      error: { code: 4, message: "not found" },
    });
    assert.equal(r.error?.code, 4);
  });

  it("validates CutParams", () => {
    const p = CutParams.parse({ projectRoot: "/x", name: "PL-1" });
    assert.equal(p.name, "PL-1");
  });

  it("rejects CutParams missing projectRoot", () => {
    assert.throws(() => CutParams.parse({ name: "PL-1" }));
  });

  it("validates RegisterParams", () => {
    const r = RegisterParams.parse({
      root: "/x",
      name: "p",
      proxyPort: 8080,
      worktreeRoot: ".worktree",
      sources: [{ name: "A", worktreePath: "/x/.worktree/A" }],
      configJson: "{}",
    });
    assert.equal(r.sources.length, 1);
  });

  it("validates TallyResult shape", () => {
    const r = TallyResult.parse({
      projects: [
        {
          name: "p",
          root: "/x",
          program: null,
          proxyPort: 8080,
          sources: [{ name: "A", state: "cold", port: null, onProgram: false }],
        },
      ],
    });
    assert.equal(r.projects.length, 1);
  });
});
