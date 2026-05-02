import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { Source } from "../supervisor/source.js";
import { Bus } from "./bus.js";

function fakeSource(name: string, state: "cold" | "starting" | "warm" | "failed", port: number): Source {
  return { name, port, state } as unknown as Source;
}

describe("Bus", () => {
  it("returns null target when no program", () => {
    const bus = new Bus();
    assert.equal(bus.programTarget(), null);
    assert.equal(bus.programName(), null);
  });

  it("returns null target when program is not warm", () => {
    const bus = new Bus();
    bus.setProgram(fakeSource("x", "starting", 41000));
    assert.equal(bus.programTarget(), null);
    assert.equal(bus.programName(), "x");
  });

  it("returns target when program is warm", () => {
    const bus = new Bus();
    bus.setProgram(fakeSource("x", "warm", 41000));
    assert.deepEqual(bus.programTarget(), { port: 41000 });
  });

  it("clears program when set to null", () => {
    const bus = new Bus();
    bus.setProgram(fakeSource("x", "warm", 41000));
    bus.setProgram(null);
    assert.equal(bus.programTarget(), null);
    assert.equal(bus.programName(), null);
  });
});
