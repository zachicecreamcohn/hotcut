import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { ProjectConfig } from "./schema.js";

describe("ProjectConfig", () => {
  it("accepts a minimal config and applies defaults", () => {
    const result = ProjectConfig.parse({
      project: { name: "p" },
      run: { cmd: "npm start" },
    });
    assert.equal(result.project.worktree_root, ".worktree");
    assert.equal(result.project.proxy_port, 8080);
    assert.equal(result.run.shutdown_timeout, "5s");
    assert.equal(result.run.restart_on_crash, true);
    assert.equal(result.run.ready.protocol, "http");
    assert.equal(result.run.ready.endpoint, "/");
    assert.equal(result.run.ready.timeout, "30s");
    assert.equal(result.run.ready.poll_interval, "200ms");
  });

  it("rejects empty project name", () => {
    const out = ProjectConfig.safeParse({
      project: { name: "" },
      run: { cmd: "x" },
    });
    assert.equal(out.success, false);
  });

  it("rejects bad duration in shutdown_timeout", () => {
    const out = ProjectConfig.safeParse({
      project: { name: "p" },
      run: { cmd: "x", shutdown_timeout: "thirty seconds" },
    });
    assert.equal(out.success, false);
  });

  it("rejects out-of-range proxy_port", () => {
    const out = ProjectConfig.safeParse({
      project: { name: "p", proxy_port: 0 },
      run: { cmd: "x" },
    });
    assert.equal(out.success, false);
  });

  it("accepts a shared service with always-ready", () => {
    const out = ProjectConfig.parse({
      project: { name: "p" },
      run: { cmd: "x" },
      shared: [{ name: "tts", cmd: "yarn dev" }],
    });
    assert.equal(out.shared.length, 1);
    const s = out.shared[0]!;
    assert.equal(s.name, "tts");
    assert.equal(s.cwd, ".");
    assert.equal(s.port, undefined);
    assert.deepEqual(s.ready, { always: true });
  });

  it("accepts a shared service with http readiness when port is given", () => {
    const out = ProjectConfig.parse({
      project: { name: "p" },
      run: { cmd: "x" },
      shared: [
        {
          name: "tts",
          cmd: "yarn dev",
          port: 8081,
          ready: { endpoint: "/health", protocol: "https" },
        },
      ],
    });
    const ready = out.shared[0]!.ready;
    if (!("endpoint" in ready)) throw new Error("expected endpoint ready");
    assert.equal(ready.endpoint, "/health");
    assert.equal(ready.protocol, "https");
    assert.equal(ready.timeout, "30s");
  });

  it("rejects shared http readiness without a port", () => {
    const out = ProjectConfig.safeParse({
      project: { name: "p" },
      run: { cmd: "x" },
      shared: [{ name: "tts", cmd: "yarn dev", ready: { endpoint: "/" } }],
    });
    assert.equal(out.success, false);
  });

  it("rejects duplicate shared service names", () => {
    const out = ProjectConfig.safeParse({
      project: { name: "p" },
      run: { cmd: "x" },
      shared: [
        { name: "tts", cmd: "a" },
        { name: "tts", cmd: "b" },
      ],
    });
    assert.equal(out.success, false);
  });
});
