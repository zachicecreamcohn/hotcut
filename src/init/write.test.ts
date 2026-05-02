import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import TOML from "@iarna/toml";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ProjectConfig } from "../config/schema.js";
import { ConfigExistsError, renderConfig, writeInitConfig } from "./write.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hotcut-init-w-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const detection = {
  projectName: "myapp",
  worktreeRoot: ".worktree",
  proxyPort: 8080,
  cmd: "npm run dev",
  notes: [],
};

describe("renderConfig", () => {
  it("produces TOML that parses against ProjectConfig", () => {
    const text = renderConfig(detection);
    const parsed = TOML.parse(text);
    const cfg = ProjectConfig.parse(parsed);
    assert.equal(cfg.project.name, "myapp");
    assert.equal(cfg.project.proxy_port, 8080);
    assert.equal(cfg.run.cmd, "npm run dev");
  });

  it("escapes special characters in cmd", () => {
    const text = renderConfig({
      ...detection,
      cmd: 'sh -c "echo \\"hi\\""',
    });
    const parsed = TOML.parse(text) as { run: { cmd: string } };
    assert.equal(parsed.run.cmd, 'sh -c "echo \\"hi\\""');
  });
});

describe("writeInitConfig", () => {
  it("writes hotcut.toml at the project root", async () => {
    const path = await writeInitConfig(dir, detection);
    const text = await readFile(path, "utf8");
    assert.ok(text.includes("[project]"));
    assert.ok(text.includes('name = "myapp"'));
  });

  it("refuses to overwrite without force", async () => {
    await writeFile(join(dir, "hotcut.toml"), "existing\n");
    await assert.rejects(() => writeInitConfig(dir, detection), ConfigExistsError);
  });

  it("overwrites with force", async () => {
    await writeFile(join(dir, "hotcut.toml"), "existing\n");
    const path = await writeInitConfig(dir, detection, { force: true });
    const text = await readFile(path, "utf8");
    assert.ok(text.includes("[project]"));
  });
});
