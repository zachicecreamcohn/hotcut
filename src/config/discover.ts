import { stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const CONFIG_FILENAME = "hotcut.toml";

export class ProjectNotFoundError extends Error {
  constructor(readonly startedFrom: string) {
    super(
      `No ${CONFIG_FILENAME} found in ${startedFrom} or any parent directory.\n` +
        `Run \`hotcut init\` here, or pass --project-root explicitly.`,
    );
    this.name = "ProjectNotFoundError";
  }
}

/**
 * Walk upward from `startDir` looking for a directory containing `hotcut.toml`.
 * Returns the absolute path of the project root, or throws ProjectNotFoundError.
 */
export async function findProjectRoot(startDir: string): Promise<string> {
  let current = resolve(startDir);
  while (true) {
    if (await fileExists(resolve(current, CONFIG_FILENAME))) return current;
    const parent = dirname(current);
    if (parent === current) throw new ProjectNotFoundError(startDir);
    current = parent;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}
