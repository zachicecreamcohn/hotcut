import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ProjectConfig } from "../config/schema.js";
import { SetupRunner } from "./setup-runner.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hotcut-setup-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function build(setup: unknown[]): ProjectConfig {
  return ProjectConfig.parse({
    project: { name: "test", proxy_port: 1 },
    run: { cmd: "true" },
    setup,
  });
}

describe("SetupRunner", () => {
  it("runs steps sequentially and marks each done", async () => {
    const cfg = build([
      { name: "a", cmd: "echo first > a.txt" },
      { name: "b", cmd: "echo second > b.txt" },
    ]);
    const runner = new SetupRunner({
      projectRoot: dir,
      projectConfig: cfg,
      steps: cfg.setup,
    });
    await runner.run();
    const s = runner.status();
    assert.deepEqual(
      s.map((x) => [x.name, x.state]),
      [["a", "done"], ["b", "done"]],
    );
  });

  it("aborts on the first failing step and leaves remaining as pending", async () => {
    const cfg = build([
      { name: "a", cmd: "true" },
      { name: "b", cmd: "exit 7" },
      { name: "c", cmd: "true" },
    ]);
    const runner = new SetupRunner({
      projectRoot: dir,
      projectConfig: cfg,
      steps: cfg.setup,
    });
    await assert.rejects(runner.run(), /setup step 'b' failed.*exit 7/s);
    const s = runner.status();
    assert.equal(s[0]!.state, "done");
    assert.equal(s[1]!.state, "failed");
    assert.equal(s[2]!.state, "pending");
  });

  it("times out long-running steps", async () => {
    const cfg = build([{ name: "slow", cmd: "sleep 10", timeout: "100ms" }]);
    const runner = new SetupRunner({
      projectRoot: dir,
      projectConfig: cfg,
      steps: cfg.setup,
    });
    await assert.rejects(runner.run(), /timed out/);
    assert.equal(runner.status()[0]!.state, "failed");
  });

  it("captures stdout into a per-step log buffer", async () => {
    await writeFile(join(dir, "say.sh"), "#!/bin/sh\necho hello-from-setup\n");
    const cfg = build([{ name: "talky", cmd: "sh say.sh" }]);
    const runner = new SetupRunner({
      projectRoot: dir,
      projectConfig: cfg,
      steps: cfg.setup,
    });
    await runner.run();
    const buf = runner.getBuffer("talky")!;
    const lines = buf.recent(10).map((e) => e.line);
    assert.ok(lines.some((l) => l.includes("hello-from-setup")), "expected captured stdout, got: " + JSON.stringify(lines));
  });

  it("expands $HOTCUT_PROJECT in step env values", async () => {
    const cfg = build([
      { name: "echo", cmd: "echo $TARGET", env: { TARGET: "$HOTCUT_PROJECT" } },
    ]);
    const runner = new SetupRunner({
      projectRoot: dir,
      projectConfig: cfg,
      steps: cfg.setup,
    });
    await runner.run();
    const lines = runner.getBuffer("echo")!.recent(10).map((e) => e.line);
    assert.ok(lines.some((l) => l.includes("test")), "expected project name in output: " + JSON.stringify(lines));
  });

  it("emits onChange before and after each step", async () => {
    const events: string[] = [];
    const cfg = build([
      { name: "a", cmd: "true" },
      { name: "b", cmd: "true" },
    ]);
    const runner = new SetupRunner({
      projectRoot: dir,
      projectConfig: cfg,
      steps: cfg.setup,
      onChange: () => events.push(runner.status().map((s) => s.name + ":" + s.state).join(",")),
    });
    await runner.run();
    // 4 events expected: a:running, a:done, b:running, b:done
    assert.equal(events.length, 4, "got: " + JSON.stringify(events));
    assert.match(events[0]!, /a:running/);
    assert.match(events[1]!, /a:done/);
    assert.match(events[2]!, /b:running/);
    assert.match(events[3]!, /b:done/);
  });
});
