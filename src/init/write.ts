import { writeFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { CONFIG_FILENAME } from "../config/discover.js";
import type { DetectionResult } from "./detect.js";

export class ConfigExistsError extends Error {
  constructor(readonly path: string) {
    super(
      `${CONFIG_FILENAME} already exists at ${path}.\n` +
        `Pass --force to overwrite.`,
    );
    this.name = "ConfigExistsError";
  }
}

export interface WriteOptions {
  force?: boolean;
}

export async function writeInitConfig(
  projectRoot: string,
  detection: DetectionResult,
  opts: WriteOptions = {},
): Promise<string> {
  const path = resolve(projectRoot, CONFIG_FILENAME);
  if (!opts.force && (await fileExists(path))) {
    throw new ConfigExistsError(path);
  }
  const contents = renderConfig(detection);
  await writeFile(path, contents, { encoding: "utf8" });
  return path;
}

export function renderConfig(detection: DetectionResult): string {
  const { projectName, worktreeRoot, proxyPort, cmd } = detection;
  return [
    "[project]",
    `name = ${quote(projectName)}`,
    `worktree_root = ${quote(worktreeRoot)}`,
    `proxy_port = ${proxyPort}`,
    "",
    "[run]",
    `cmd = ${quote(cmd)}`,
    "",
  ].join("\n");
}

function quote(s: string): string {
  return JSON.stringify(s);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}
