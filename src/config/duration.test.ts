import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { Duration, toMs } from "./duration.js";

describe("Duration", () => {
  it("accepts valid duration strings", () => {
    for (const v of ["200ms", "5s", "30s", "1m", "1h"]) {
      assert.equal(Duration.safeParse(v).success, true, v);
    }
  });

  it("rejects nonsense", () => {
    for (const v of ["thirty seconds", "", "abc"]) {
      assert.equal(Duration.safeParse(v).success, false, v);
    }
  });
});

describe("toMs", () => {
  it("parses to numbers", () => {
    assert.equal(toMs("200ms"), 200);
    assert.equal(toMs("5s"), 5000);
  });

  it("throws on invalid", () => {
    assert.throws(() => toMs("nope"), /invalid duration/);
  });
});
