// scripts/migrate-icon-imports.mjs
// U2: 把渲染层所有 `from 'lucide-react'` 改指向图标契约单一导出口。
// 名称不变，只改来源路径——机械且安全。icons.ts 本身与 ui/ 下同目录文件用相对路径。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('apps/desktop/src');
const BARREL = path.resolve('apps/desktop/src/components/ui/icons.ts');

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.tsx?$/.test(e.name)) acc.push(p);
  }
  return acc;
}

function relImport(fromFile) {
  let rel = path.relative(path.dirname(fromFile), BARREL).replace(/\\/g, '/');
  rel = rel.replace(/\.ts$/, '');
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

let changed = 0;
for (const file of walk(ROOT)) {
  if (path.resolve(file) === BARREL) continue;
  const src = fs.readFileSync(file, 'utf8');
  if (!src.includes("'lucide-react'")) continue;
  const spec = relImport(file);
  const next = src.replace(/from 'lucide-react'/g, `from '${spec}'`);
  if (next !== src) {
    fs.writeFileSync(file, next);
    changed++;
  }
}
console.log('rewrote imports in', changed, 'files -> barrel');
