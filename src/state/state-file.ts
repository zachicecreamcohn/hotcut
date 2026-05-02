import { open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

export const PersistedSource = z.object({
  name: z.string(),
  port: z.number().int(),
});
export type PersistedSource = z.infer<typeof PersistedSource>;

export const PersistedProject = z.object({
  root: z.string(),
  name: z.string(),
  proxyPort: z.number().int(),
  worktreeRoot: z.string(),
  sources: z.array(PersistedSource).default([]),
});
export type PersistedProject = z.infer<typeof PersistedProject>;

export const PersistedState = z.object({
  version: z.literal(1),
  projects: z.array(PersistedProject).default([]),
});
export type PersistedState = z.infer<typeof PersistedState>;

export const EMPTY_STATE: PersistedState = { version: 1, projects: [] };

export async function readState(path: string): Promise<PersistedState> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return EMPTY_STATE;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error("state.json is not valid JSON: " + (err as Error).message);
  }
  const result = PersistedState.safeParse(parsed);
  if (!result.success) {
    throw new Error("state.json failed schema validation: " + result.error.message);
  }
  return result.data;
}

export async function writeStateAtomic(
  path: string,
  state: PersistedState,
): Promise<void> {
  const dir = dirname(path);
  const tmp = join(dir, "." + Date.now() + "." + process.pid + ".state.tmp");
  const fh = await open(tmp, "w", 0o600);
  try {
    await fh.writeFile(JSON.stringify(state, null, 2), "utf8");
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}
