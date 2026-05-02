import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { IllegalTransitionError, StateMachine } from "./state.js";

describe("StateMachine", () => {
  it("starts cold", () => {
    const m = new StateMachine();
    assert.equal(m.state, "cold");
  });

  it("walks the happy path", () => {
    const m = new StateMachine();
    m.transition("starting");
    m.transition("warm");
    m.transition("cold");
    assert.equal(m.state, "cold");
  });

  it("rejects illegal transitions", () => {
    const m = new StateMachine();
    assert.throws(() => m.transition("warm"), IllegalTransitionError);
  });

  it("ignores no-op transitions", () => {
    const m = new StateMachine();
    m.transition("starting");
    m.transition("starting");
    assert.equal(m.state, "starting");
  });

  it("allows recovery from failed", () => {
    const m = new StateMachine();
    m.transition("starting");
    m.transition("failed");
    m.transition("starting");
    assert.equal(m.state, "starting");
  });
});
