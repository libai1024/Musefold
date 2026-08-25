// scripts/build-website-icon-sprite.mjs
// SITE-03：官网 Lucide 同源 sprite。读取 website/Musefold/icons.json 字形清单，
// 从仓库 lucide-react 同版本的 SVG 节点生成 website/Musefold/assets/icons.svg。
// 页面用 <use href="assets/icons.svg#i-download">；线宽由 styles.css 统一 1.75。
// 守卫（HTML <use> 引用 ⊆ 清单、禁手绘 path）在 scripts/check-icon-contract.mjs。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = path.join(ROOT, "website/Musefold/icons.json");
const OUTPUT = path.join(ROOT, "website/Musefold/assets/icons.svg");
const ICONS_DIR = path.join(ROOT, "node_modules/lucide-react/dist/esm/icons");

const names = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
if (!Array.isArray(names) || names.length === 0) {
  throw new Error("icons.json must be a non-empty array of lucide glyph names");
}

const symbols = [];
for (const name of names) {
  if (!/^[a-z0-9-]+$/.test(name)) {
    throw new Error(`invalid glyph name: ${name}`);
  }
  const module = `${ICONS_DIR}/${name}.mjs`;
  if (!fs.existsSync(module)) {
    throw new Error(`lucide-react has no glyph "${name}"`);
  }
  const { __iconNode } = await import(`file://${module}`);
  if (!Array.isArray(__iconNode)) {
    throw new Error(`glyph "${name}" exports no __iconNode`);
  }
  const body = __iconNode
    .map(([tag, attrs]) => {
      const serialized = Object.entries(attrs)
        .filter(([key]) => key !== "key")
        .map(([key, value]) => `${key}="${value}"`)
        .join(" ");
      return `<${tag}${serialized ? " " + serialized : ""}/>`;
    })
    .join("");
  symbols.push(`<symbol id="i-${name}" viewBox="0 0 24 24">${body}</symbol>`);
}

const sprite = `<svg xmlns="http://www.w3.org/2000/svg">${symbols.join("")}</svg>\n`;
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, sprite);
console.log(`website icon sprite: ${names.length} glyphs -> ${path.relative(ROOT, OUTPUT)}`);
