#!/usr/bin/env node
// v1.4 GOV-05：Theater 字体子集再生成（docs/v1.4/V14-DELIVERY-PLAN.md）。
// 品牌名字体（workbench 空态等）走同一管线：ZCOOL XiaoWei 拉丁子集。
//
// 产物（提交入库）：
//   packages/ui/fonts/{syne-var.woff2, noto-sans-sc-var-subset.woff2, zcool-xiaowei-subset.woff2,
//     OFL-Syne.txt, OFL-NotoSansSC.txt, OFL-ZCOOLXiaoWei.txt}
//   website/Musefold/assets/fonts/  同一组文件（官网与引导各自自托管，禁止运行时 Google Fonts）
//
// 字体源（不入库，脚本自动下载到 --src 目录并缓存）：
//   https://raw.githubusercontent.com/google/fonts/main/ofl/syne/Syne%5Bwght%5D.ttf
//   https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf
//   https://raw.githubusercontent.com/google/fonts/main/ofl/zcoolxiaowei/ZCOOLXiaoWei-Regular.ttf
//   OFL.txt 同目录。
//
// 依赖：python3 + fonttools + brotli（pip install fonttools brotli）。
// pyftsubset 路径可用环境变量 PYFTSUBSET 覆盖，默认取 PATH 上的 pyftsubset。
//
// 用法：node scripts/build-font-subsets.mjs [--src artifacts/fonts-src]
//   1. 修改 scripts/font-subset-text.txt（中文标题字表）；
//   2. 运行本脚本；
//   3. 预算断言：单文件 < 200KB（技术选型 GOV-05），超出即失败，重切字表而不是放宽预算。

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const srcArgIndex = process.argv.indexOf("--src");
const SRC_DIR = path.resolve(
  REPO_ROOT,
  srcArgIndex > -1 ? process.argv[srcArgIndex + 1] : "artifacts/fonts-src",
);
const PYFTSUBSET = process.env.PYFTSUBSET ?? "pyftsubset";
const BUDGET_BYTES = 200 * 1024;

const OUT_DIRS = [
  path.join(REPO_ROOT, "packages/ui/fonts"),
  path.join(REPO_ROOT, "website/Musefold/assets/fonts"),
];

const SOURCES = [
  {
    file: "Syne[wght].ttf",
    url: "https://raw.githubusercontent.com/google/fonts/main/ofl/syne/Syne%5Bwght%5D.ttf",
  },
  {
    file: "NotoSansSC[wght].ttf",
    url: "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf",
  },
  { file: "OFL-Syne.txt", url: "https://raw.githubusercontent.com/google/fonts/main/ofl/syne/OFL.txt" },
  {
    file: "OFL-NotoSansSC.txt",
    url: "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/OFL.txt",
  },
  {
    file: "ZCOOLXiaoWei-Regular.ttf",
    url: "https://raw.githubusercontent.com/google/fonts/main/ofl/zcoolxiaowei/ZCOOLXiaoWei-Regular.ttf",
  },
  {
    file: "OFL-ZCOOLXiaoWei.txt",
    url: "https://raw.githubusercontent.com/google/fonts/main/ofl/zcoolxiaowei/OFL.txt",
  },
];

function ensureSources() {
  mkdirSync(SRC_DIR, { recursive: true });
  for (const src of SOURCES) {
    const dest = path.join(SRC_DIR, src.file);
    if (existsSync(dest)) continue;
    console.log(`[fonts] 下载 ${src.file}`);
    execFileSync("curl", ["-sL", "--fail", "-o", dest, src.url]);
  }
}

function readSubsetChars() {
  const raw = readFileSync(path.join(REPO_ROOT, "scripts/font-subset-text.txt"), "utf8");
  const chars = new Set();
  for (const line of raw.split("\n")) {
    if (line.startsWith("#")) continue;
    for (const ch of line.trim()) chars.add(ch);
  }
  return [...chars].join("");
}

function subset(input, output, extraArgs) {
  execFileSync(PYFTSUBSET, [
    input,
    `--output-file=${output}`,
    "--flavor=woff2",
    "--layout-features=*",
    "--no-hinting",
    "--desubroutinize",
    ...extraArgs,
  ]);
  const bytes = statSync(output).size;
  const label = path.basename(output);
  console.log(`[fonts] ${label}  ${(bytes / 1024).toFixed(1)} KB`);
  if (bytes > BUDGET_BYTES) {
    console.error(`[fonts] ${label} 超出 200KB 预算——重切字表，不放宽预算（GOV-05）`);
    process.exit(1);
  }
  return output;
}

ensureSources();
const stage = path.join(SRC_DIR, "out");
mkdirSync(stage, { recursive: true });

// Syne：拉丁与数字的 display（变量字体保留 wght 轴）。基本拉丁 + 常用排印符号。
const syneOut = subset(path.join(SRC_DIR, "Syne[wght].ttf"), path.join(stage, "syne-var.woff2"), [
  "--unicodes=U+0020-007E,U+00A9,U+2013-2014,U+2018-201D,U+2026",
]);

// Noto Sans SC：中文标题子集（变量，字表来自 scripts/font-subset-text.txt）。
const notoOut = subset(
  path.join(SRC_DIR, "NotoSansSC[wght].ttf"),
  path.join(stage, "noto-sans-sc-var-subset.woff2"),
  [`--text=${readSubsetChars()}`],
);

// ZCOOL XiaoWei：品牌名（workbench 空态）拉丁展示体，与 Syne 同一字表。单字重 400，非变量。
const zcoolOut = subset(
  path.join(SRC_DIR, "ZCOOLXiaoWei-Regular.ttf"),
  path.join(stage, "zcool-xiaowei-subset.woff2"),
  ["--unicodes=U+0020-007E,U+00A9,U+2013-2014,U+2018-201D,U+2026"],
);

for (const dir of OUT_DIRS) {
  mkdirSync(dir, { recursive: true });
  copyFileSync(syneOut, path.join(dir, "syne-var.woff2"));
  copyFileSync(notoOut, path.join(dir, "noto-sans-sc-var-subset.woff2"));
  copyFileSync(zcoolOut, path.join(dir, "zcool-xiaowei-subset.woff2"));
  copyFileSync(path.join(SRC_DIR, "OFL-Syne.txt"), path.join(dir, "OFL-Syne.txt"));
  copyFileSync(path.join(SRC_DIR, "OFL-NotoSansSC.txt"), path.join(dir, "OFL-NotoSansSC.txt"));
  copyFileSync(path.join(SRC_DIR, "OFL-ZCOOLXiaoWei.txt"), path.join(dir, "OFL-ZCOOLXiaoWei.txt"));
  console.log(`[fonts] 已写入 ${path.relative(REPO_ROOT, dir)}`);
}
console.log("[fonts] 完成");
