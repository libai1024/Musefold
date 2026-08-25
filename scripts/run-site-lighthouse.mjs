import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = path.join(repoRoot, "website/Musefold/lighthouserc.json");
const chromePath = chromium.executablePath();
const command = process.platform === "win32" ? "lhci.cmd" : "lhci";

function run(args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const collectStatus = run(["collect", `--config=${config}`, `--chromePath=${chromePath}`]);
if (collectStatus !== 0) process.exit(collectStatus);
process.exit(run(["assert", `--config=${config}`]));
