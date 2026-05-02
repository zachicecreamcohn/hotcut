import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { readState, writeStateAtomic, EMPTY_STATE } from "./state-file.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hotcut-state-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("state-file", () => {
  it("returns empty when file is missing", async () => {
    const s = await readState(join(dir, "state.json"));
    assert.deepEqual(s, EMPTY_STATE);
  });

  it("roundtrips state through atomic write", async () => {
    const path = join(dir, "state.json");
    await writeStateAtomic(path, {
      version: 1,
      projects: [
        {
          root: "/x",
          name: "p",
          proxyPort: 8080,
          worktreeRoot: ".worktree",
          sources: [{ name: "A", port: 41000 }],
        },
      ],
    });
    const back = await readState(path);
    assert.equal(back.projects.length, 1);
    assert.equal(back.projects[0]!.name, "p");
    assert.equal(back.projects[0]!.sources[0]!.port, 41000);
  });

  it("rejects garbage json", async () => {
    const path = join(dir, "state.json");
    await writeFile(path, "not json", "utf8");
    await assert.rejects(() => readState(path), /not valid JSON/);
  });

  it("rejects schema-invalid content", async () => {
    const path = join(dir, "state.json");
    await writeFile(path, JSON.stringify({ version: 99 }), "utf8");
    await assert.rejects(() => readState(path), /schema validation/);
  });

  it("does not leave a tmp file on success", async () => {
    const path = join(dir, "state.json");
    await writeStateAtomic(path, EMPTY_STATE);
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(dir);
    assert.deepEqual(files, ["state.json"]);
  });
});
