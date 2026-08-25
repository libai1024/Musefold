#!/usr/bin/env node
// v1.4 WEB-01：Web 端自对比工具——「零视觉变更」的机器定义。
// 桌面侧在 WEB-01 不动，因此每一批 CSS 迁移的门禁是 Web 自身前后像素对比，
// 全量双端对比（npm run test:visual:shared）留到批次里程碑与收口。
//
// 用法：
//   node scripts/diff-web-visuals.mjs capture <label>
//     跑 apps/web 两个视觉用例，把截图落盘到 artifacts/v1.4/web-visuals/<label>/
//   node scripts/diff-web-visuals.mjs compare <labelA> <labelB> [maxMean] [maxChanged]
//     逐张对比两个目录的同名 PNG。默认阈值 0（要求逐像素一致）；
//     若捕捉存在固有噪声，先用两次 capture 的互比确定噪声底，再据此传入阈值。

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { comparePng } from "./lib/png-compare.mjs";

const root = resolve(import.meta.dirname, "..");
const baseDir = join(root, "artifacts/v1.4/web-visuals");
const [mode, a, b, maxMeanArg, maxChangedArg] = process.argv.slice(2);

if (mode === "capture") {
  if (!a) {
    console.error("用法：capture <label>");
    process.exit(2);
  }
  const outDir = join(baseDir, a);
  mkdirSync(outDir, { recursive: true });
  const result = spawnSync(
    "npm",
    [
      "run",
      "test:e2e",
      "--workspace",
      "@musefold/web",
      "--",
      "--grep",
      "canonical Desktop/Web surfaces|generation result failure",
    ],
    {
      cwd: root,
      env: { ...process.env, MUSEFOLD_VISUAL_OUTPUT_DIR: outDir },
      stdio: "inherit",
    },
  );
  process.exit(result.status ?? 1);
}

if (mode === "compare") {
  if (!a || !b) {
    console.error("用法：compare <labelA> <labelB> [maxMean] [maxChanged]");
    process.exit(2);
  }
  const maxMean = Number(maxMeanArg ?? 0);
  const maxChanged = Number(maxChangedArg ?? 0);
  const dirA = join(baseDir, a);
  const dirB = join(baseDir, b);
  const files = readdirSync(dirA).filter(
    (f) => f.endsWith(".png") && existsSync(join(dirB, f)),
  );
  if (files.length === 0) {
    console.error(`没有可对比的同名 PNG：${dirA} vs ${dirB}`);
    process.exit(1);
  }
  let failed = false;
  for (const file of files.sort()) {
    const r = comparePng(join(dirA, file), join(dirB, file));
    const ok = r.meanError <= maxMean && r.changedPixelRatio <= maxChanged;
    const sizeNote =
      r.leftWidth !== r.rightWidth || r.leftHeight !== r.rightHeight
        ? `  尺寸 ${r.leftWidth}x${r.leftHeight} -> ${r.rightWidth}x${r.rightHeight}`
        : "";
    console.log(
      `${ok ? "ok  " : "FAIL"}  ${file}  mean=${r.meanError.toFixed(6)}  changed=${r.changedPixelRatio.toFixed(6)}${sizeNote}`,
    );
    if (!ok) failed = true;
  }
  const missing = readdirSync(dirA).filter(
    (f) => f.endsWith(".png") && !existsSync(join(dirB, f)),
  );
  for (const file of missing) console.error(`MISSING in ${b}: ${file}`);
  if (failed || missing.length > 0) process.exit(1);
  console.log(`对比通过：${files.length} 张（mean<=${maxMean} changed<=${maxChanged}）`);
  process.exit(0);
}

console.error("用法：capture <label> | compare <labelA> <labelB> [maxMean] [maxChanged]");
process.exit(2);
