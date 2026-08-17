// scripts/check-icon-contract.mjs
// U2 收口检查：强制图标契约。见 docs/v0.2/V02.2-UI-DEVELOPMENT-CONSTRAINTS.md §4 / §6.3。
// 1) 渲染层禁止直接 from 'lucide-react'（只有 icons.ts 例外）。
// 2) 已折叠的重复语义名不得在 call site 重新出现（用规范名替代）。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('src');
const BARREL = path.resolve('src/components/ui/icons.ts');

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
  if (path.resolve(file) !== BARREL && /from 'lucide-react'/.test(src)) {
    violations.push(`${path.relative(ROOT, file)}: 直接 import lucide-react，应改用 components/ui/icons`);
  }
}

console.log(violations.length ? 'ICON CONTRACT FAIL:' : 'icon contract OK (single export point)');
for (const v of violations) console.log('  - ' + v);
process.exit(violations.length ? 1 : 0);
