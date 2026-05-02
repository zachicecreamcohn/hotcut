import { stat, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { findFreePort } from "../supervisor/port.js";
import { DEFAULTS } from "../config/defaults.js";

export interface DetectionResult {
  projectName: string;
  worktreeRoot: string;
  proxyPort: number;
  cmd: string;
  notes: string[];
}

interface PackageJson {
  name?: unknown;
  scripts?: Record<string, unknown>;
}

export async function detectProject(projectRoot: string): Promise<DetectionResult> {
  const notes: string[] = [];
  const root = resolve(projectRoot);

  const cmd = await detectRunCmd(root, notes);
  const worktreeRoot = await detectWorktreeRoot(root, notes);
  const projectName = await detectProjectName(root, notes);
  const proxyPort = await detectProxyPort(notes);

  return { projectName, worktreeRoot, proxyPort, cmd, notes };
}

async function detectRunCmd(root: string, notes: string[]): Promise<string> {
  const pkgPath = resolve(root, "package.json");
  let pkg: PackageJson | undefined;
  try {
    const raw = await readFile(pkgPath, "utf8");
    pkg = JSON.parse(raw) as PackageJson;
  } catch {
    notes.push("no package.json found; defaulting cmd to \"npm start\"");
    return "npm start";
  }
  const scripts =
    pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
  for (const candidate of ["dev", "start"]) {
    if (typeof scripts[candidate] === "string") {
      const cmd = candidate === "start" ? "npm start" : `npm run ${candidate}`;
      notes.push(`detected: package.json scripts.${candidate} → ${cmd}`);
      return cmd;
    }
  }
  notes.push("package.json has no dev/start script; defaulting cmd to \"npm start\"");
  return "npm start";
}

async function detectWorktreeRoot(root: string, notes: string[]): Promise<string> {
  const candidate = resolve(root, DEFAULTS.worktreeRoot);
  if (await isDirectory(candidate)) {
    notes.push(`detected: ${DEFAULTS.worktreeRoot}/`);
    return DEFAULTS.worktreeRoot;
  }
  notes.push(
    `no ${DEFAULTS.worktreeRoot}/ found; defaulting worktree_root to "${DEFAULTS.worktreeRoot}"`,
  );
  return DEFAULTS.worktreeRoot;
}

async function detectProjectName(root: string, notes: string[]): Promise<string> {
  const pkgPath = resolve(root, "package.json");
  try {
    const raw = await readFile(pkgPath, "utf8");
    const pkg = JSON.parse(raw) as PackageJson;
    if (typeof pkg.name === "string" && pkg.name.length > 0) {
      const cleaned = pkg.name.replace(/^@[^/]+\//, "");
      notes.push(`detected: package.json name → ${cleaned}`);
      return cleaned;
    }
  } catch {
    // fall through
  }
  const fallback = basename(root);
  notes.push(`using directory name → ${fallback}`);
  return fallback;
}

async function detectProxyPort(notes: string[]): Promise<number> {
  const preferred = DEFAULTS.proxyPort;
  if (await isPortFree(preferred)) {
    notes.push(`proxy_port ${preferred} is free`);
    return preferred;
  }
  const fallback = await findFreePort({ start: preferred + 1, end: preferred + 1000 });
  notes.push(`proxy_port ${preferred} in use; chose ${fallback}`);
  return fallback;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function isPortFree(port: number): Promise<boolean> {
  try {
    const got = await findFreePort({ start: port, end: port + 1 });
    return got === port;
  } catch {
    return false;
  }
}
