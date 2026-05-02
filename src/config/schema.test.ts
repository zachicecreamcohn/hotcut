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
    assert.equal(result.run.ready.http, "/");
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
});
