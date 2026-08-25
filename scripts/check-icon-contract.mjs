// scripts/check-icon-contract.mjs
// U2 收口检查：强制图标契约。见 docs/v0.2/V02.2-UI-DEVELOPMENT-CONSTRAINTS.md §4 / §6.3。
// 1) 渲染层禁止直接 from 'lucide-react'（只有 icons.ts 例外）。
// 2) 已折叠的重复语义名不得在 call site 重新出现（用规范名替代）。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('apps/desktop/src');
const BARREL = path.resolve('apps/desktop/src/components/ui/icons.ts');

// 已废除/折叠的名字：应改用右侧规范名。
const DEPRECATED = {
  PencilLine: 'Pencil',
  CircleAlert: 'AlertCircle',
  TriangleAlert: 'AlertTriangle',
  ImageIcon: 'Image',
  LoaderCircle: 'Loader2',
  RotateCw: 'RotateCcw (仅重试语义) / 保留 RefreshCw 作重新加载',
  RefreshCcw: 'RefreshCw',
  Trash: 'Trash2',
  MoreVertical: 'MoreHorizontal',
};

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.tsx?$/.test(e.name)) acc.push(p);
  }
  return acc;
}

const violations = [];
for (const file of walk(ROOT)) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  if (path.resolve(file) !== BARREL && /from 'lucide-react'/.test(src)) {
    violations.push(`${rel}: 直接 import lucide-react，应改用 components/ui/icons`);
  }
  if (path.resolve(file) === BARREL) continue;
  for (const [deprecated, canonical] of Object.entries(DEPRECATED)) {
    if (new RegExp(`\\b${deprecated}\\b`).test(src)) {
      violations.push(`${rel}: 使用已折叠图标名 ${deprecated}，应改用 ${canonical}`);
    }
  }
}

console.log(violations.length ? 'ICON CONTRACT FAIL:' : 'icon contract OK (single export point)');
for (const v of violations) console.log('  - ' + v);

// SITE-03：官网 Lucide 同源 sprite 契约。
// <use> 引用必须 ⊆ icons.json 清单；官网 HTML 禁止内联手绘图形与外部图标库。
const siteRoot = path.resolve('website/Musefold');
const manifestPath = path.join(siteRoot, 'icons.json');
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const allowed = new Set(manifest.map((name) => `i-${name}`));
  for (const entry of fs.readdirSync(siteRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.html?$/.test(entry.name)) continue;
    const html = fs.readFileSync(path.join(siteRoot, entry.name), 'utf8');
    for (const match of html.matchAll(/<use\s[^>]*href="assets\/icons\.svg#([a-z0-9-]+)"/g)) {
      if (!allowed.has(match[1])) {
        violations.push(`${entry.name}: <use> 引用清单外字形 ${match[1]}，先登记 icons.json`);
      }
    }
    const handDrawn = /<(path|circle|rect|polygon|polyline|line|ellipse)\b/.test(
      html.replace(/<use\s[^>]*>/g, ''),
    );
    if (handDrawn) {
      violations.push(`${entry.name}: 内联手绘 SVG 图形，官网图形一律走 assets/icons.svg sprite`);
    }
    if (/font-?awesome|fontawesome|fa-solid/i.test(html)) {
      violations.push(`${entry.name}: 引用 Font Awesome，禁止第二图标源`);
    }
  }
  console.log(violations.length ? 'SITE ICON CONTRACT FAIL:' : 'site icon contract OK (sprite only)');
  for (const v of violations) console.log('  - ' + v);
}
process.exit(violations.length ? 1 : 0);
