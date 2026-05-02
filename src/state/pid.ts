import { readFile, unlink, writeFile } from "node:fs/promises";

export async function writePidFile(path: string, pid: number = process.pid): Promise<void> {
  await writeFile(path, String(pid) + "\n", { encoding: "utf8", mode: 0o600 });
}

export async function readPidFile(path: string): Promise<number | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const n = parseInt(raw.trim(), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EPERM") return true;
    return false;
  }
}

export async function removePidFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
