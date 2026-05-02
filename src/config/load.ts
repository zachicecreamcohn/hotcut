import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import TOML from "@iarna/toml";
import { z } from "zod";
import { ProjectConfig } from "./schema.js";

function isNodeError(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === code
  );
}

export async function loadConfig(projectRoot: string): Promise<ProjectConfig> {
  const configPath = resolve(projectRoot, "hotcut.toml");
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (err) {
    if (isNodeError(err, "ENOENT")) {
      throw new Error(`No hotcut.toml found at ${configPath}`);
    }
    throw err;
  }

  const parsed = TOML.parse(raw);
  const result = ProjectConfig.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid hotcut.toml at ${configPath}:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}
