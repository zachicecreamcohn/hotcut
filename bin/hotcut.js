#!/usr/bin/env node
// Dev-time shim: runs the TypeScript CLI directly via tsx.
// When we ship a published build, this will be replaced by dist/cli/index.js.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "..", "src", "cli", "index.ts");
const tsx = resolve(here, "..", "node_modules", ".bin", "tsx");

const child = spawn(tsx, [entry, ...process.argv.slice(2)], {
  stdio: "inherit",
});

const forward = (signal) => {
  if (!child.killed) child.kill(signal);
};
process.on("SIGINT", () => forward("SIGINT"));
process.on("SIGTERM", () => forward("SIGTERM"));
process.on("SIGHUP", () => forward("SIGHUP"));

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
