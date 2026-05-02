import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { Source } from "../supervisor/source.js";
import { Bus } from "./bus.js";

function fakeSource(
  name: string,
  state: "cold" | "starting" | "warm" | "failed",
  port: number,
): Source {
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
    bus.cut(fakeSource("x", "starting", 41000));
    assert.equal(bus.programTarget(), null);
    assert.equal(bus.programName(), "x");
  });

  it("returns target when program is warm", () => {
    const bus = new Bus();
    bus.cut(fakeSource("x", "warm", 41000));
    assert.deepEqual(bus.programTarget(), { port: 41000 });
  });

  it("clear() drops the program", () => {
    const bus = new Bus();
    bus.cut(fakeSource("x", "warm", 41000));
    bus.clear();
    assert.equal(bus.programTarget(), null);
    assert.equal(bus.programName(), null);
  });

  it("notifies listeners on cut", () => {
    const bus = new Bus();
    const events: string[] = [];
    bus.onCut((e) => events.push(`${e.from ?? "-"}->${e.to}`));
    bus.cut(fakeSource("a", "warm", 1));
    bus.cut(fakeSource("b", "warm", 2));
    assert.deepEqual(events, ["-->a", "a->b"]);
  });

  it("does not notify when cutting to the same source", () => {
    const bus = new Bus();
    let count = 0;
    bus.onCut(() => count++);
    const a = fakeSource("a", "warm", 1);
    bus.cut(a);
    bus.cut(a);
    assert.equal(count, 1);
  });
});
