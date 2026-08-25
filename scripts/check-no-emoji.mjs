#!/usr/bin/env node
// v1.4 GOV-03：产品与官网表面的 emoji 机器门禁（docs/v1.4/V14-DELIVERY-PLAN.md）。
//
// 判定：\p{Extended_Pictographic}、区域指示符（旗帜）、VS16（U+FE0F）、键帽（U+20E3）。
// 文本表意符白名单：© ® ™ 与 ↔↕↖↗↘↙↩↪ 这类默认文本呈现的排版字符不算 emoji
// （代码注释与页脚版权在用），但它们一旦跟随 VS16 强制 emoji 呈现即拦截。
// 豁免仅两类（技术选型 D7）：
//   1. 行尾含「emoji-allow: <原因>」标记的测试夹具字符串——计入审计输出，不算违规；
//   2. 第三方许可文本——按文件名模式（license / third-party / notices）豁免整文件。
// 范围外目录（docs、scripts、tests 等）不扫：门禁对象是界面字符串，不是文档。
//
// 用法：node scripts/check-no-emoji.mjs [--self-test]

import { readdirSync, readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const SCAN_GROUPS = [
  { root: "apps/desktop/src", exts: [".tsx", ".ts", ".css"] },
  { root: "apps/web/src", exts: [".tsx", ".ts", ".css"] },
  { root: "packages/ui", exts: [".tsx", ".ts", ".css"] },
  { root: "packages/product-ui", exts: [".tsx", ".ts", ".css"] },
  { root: "website/Musefold", exts: [".html", ".css", ".js"] },
];

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "out",
  ".tsout",
  "coverage",
  "test-results",
  "playwright-report",
  "downloads",
  "updates",
]);

const ALLOWED_PATH_RE = /(license|third-party|notices)/i;
const ALLOW_MARKER = "emoji-allow:";

// 默认文本呈现的排版字符：©（A9）®（AE）™（2122）、双向/斜向箭头（2194–2199）、弯钩箭头（21A9–21AA）。
const TEXT_SYMBOLS = new Set([0xa9, 0xae, 0x2122, 0x2194, 0x2195, 0x2196, 0x2197, 0x2198, 0x2199, 0x21a9, 0x21aa]);

const EMOJI_RE = /\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|\uFE0F|\u20E3/gu;

function findLineViolations(line) {
  const hits = [];
  for (const match of line.matchAll(EMOJI_RE)) {
    const cp = match[0].codePointAt(0);
    const next = line.charCodeAt(match.index + match[0].length);
    if (TEXT_SYMBOLS.has(cp) && next !== 0xfe0f) continue;
    hits.push({ col: match.index + 1, cp });
  }
  return hits;
}

function checkText(relPath, text) {
  const violations = [];
  const allowances = [];
  if (ALLOWED_PATH_RE.test(path.basename(relPath))) {
    return { violations, allowances, pathAllowed: true };
  }
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const hits = findLineViolations(line);
    if (hits.length === 0) continue;
    if (line.includes(ALLOW_MARKER)) {
      allowances.push({ line: i + 1, text: line.trim() });
      continue;
    }
    for (const hit of hits) {
      violations.push({ line: i + 1, col: hit.col, cp: hit.cp, text: line.trim() });
    }
  }
  return { violations, allowances, pathAllowed: false };
}

function* walk(dir, exts) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(path.join(dir, entry.name), exts);
    } else if (exts.includes(path.extname(entry.name))) {
      yield path.join(dir, entry.name);
    }
  }
}

function formatCp(cp) {
  return `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
}

function runScan() {
  const violations = [];
  const allowances = [];
  for (const group of SCAN_GROUPS) {
    const abs = path.join(REPO_ROOT, group.root);
    if (!existsSync(abs)) continue;
    for (const file of walk(abs, group.exts)) {
      const rel = path.relative(REPO_ROOT, file);
      const result = checkText(rel, readFileSync(file, "utf8"));
      for (const v of result.violations) violations.push({ file: rel, ...v });
      for (const a of result.allowances) allowances.push({ file: rel, ...a });
    }
  }

  if (allowances.length > 0) {
    console.log(`[check-no-emoji] 审计：${allowances.length} 处 emoji-allow 豁免`);
    for (const a of allowances) console.log(`  ${a.file}:${a.line}  ${a.text}`);
  }
  if (violations.length > 0) {
    console.error(`[check-no-emoji] 发现 ${violations.length} 处 emoji 字符：`);
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}:${v.col}  ${formatCp(v.cp)}  ${v.text}`);
    }
    console.error(
      "界面禁止 emoji（v1.4 GOV-03）。图标用 packages/ui/src/icons.ts 的 Lucide；测试夹具加「emoji-allow: <原因>」行标记。",
    );
    process.exit(1);
  }
  console.log("[check-no-emoji] 通过：扫描范围内无 emoji 字符");
}

function runSelfTest() {
  const fixtures = [
    {
      name: "命中：默认 emoji 呈现字符",
      path: "apps/web/src/x.ts",
      text: 'const a = "\u{2728}";',
      violations: 1,
      allowances: 0,
    },
    {
      name: "命中：文本符 + VS16 强制 emoji 呈现",
      path: "apps/web/src/x.ts",
      text: 'const b = "\u{26A0}\u{FE0F}"; const c = "\u{2194}\u{FE0F}";',
      violations: 4, // ⚠ 本身即命中 + 其 VS16；↔ 因 VS16 命中 + 其 VS16
      allowances: 0,
    },
    {
      name: "命中：ZWJ 序列",
      path: "apps/web/src/x.ts",
      text: 'const d = "\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}";',
      violations: 3,
      allowances: 0,
    },
    {
      name: "命中：键帽序列",
      path: "apps/web/src/x.ts",
      text: 'const e = "1\u{FE0F}\u{20E3}";',
      violations: 2,
      allowances: 0,
    },
    {
      name: "豁免：行内 emoji-allow 标记",
      path: "apps/web/src/x.test.ts",
      text: 'const f = "\u{2728}"; // emoji-allow: 夹具描述用户输入了 emoji',
      violations: 0,
      allowances: 1,
    },
    {
      name: "豁免：许可文件路径",
      path: "website/Musefold/third-party-notices.html",
      text: "some vendor text \u{2728}",
      violations: 0,
      allowances: 0,
    },
    {
      name: "干净：文本表意符白名单",
      path: "website/Musefold/index.html",
      text: "\u{00A9} 2026 Musefold \u{00AE}\u{2122} epoch \u{2194} ISO",
      violations: 0,
      allowances: 0,
    },
  ];

  let failed = 0;
  for (const fx of fixtures) {
    const result = checkText(fx.path, fx.text);
    const ok = result.violations.length === fx.violations && result.allowances.length === fx.allowances;
    if (!ok) {
      failed++;
      console.error(
        `SELF-TEST FAIL: ${fx.name} — 期望 ${fx.violations} 违规/${fx.allowances} 豁免，实际 ${result.violations.length}/${result.allowances.length}`,
      );
    }
  }
  if (failed > 0) process.exit(1);
  console.log(`[check-no-emoji] self-test 通过（${fixtures.length} 组夹具）`);
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  runScan();
}
