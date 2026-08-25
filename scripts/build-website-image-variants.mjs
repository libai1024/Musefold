// SITE-05：为官网首屏真机截图生成 AVIF/WebP 响应式变体。
// AVIF 使用 macOS sips，WebP 使用现有 Chromium Canvas 编码；PNG 保留为回退源。
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetsRoot = path.join(repoRoot, "website/Musefold/assets");
const sources = [
  { name: "workbench", source: path.join(assetsRoot, "screens/workbench.png"), outputDir: path.join(assetsRoot, "screens") },
  { name: "library", source: path.join(assetsRoot, "screens/library.png"), outputDir: path.join(assetsRoot, "screens") },
  { name: "floating-library", source: path.join(assetsRoot, "works/floating-library.png"), outputDir: path.join(assetsRoot, "works") },
  { name: "away-from-agent-loop", source: path.join(assetsRoot, "works/away-from-agent-loop.png"), outputDir: path.join(assetsRoot, "works") },
];
const widths = [768, 1280];
const tempDir = mkdtempSync(path.join(os.tmpdir(), "musefold-site-images-"));

async function encodeWebp(browser, sourceData, output, width) {
  const page = await browser.newPage();
  try {
    const dataUrl = await page.evaluate(async ({ sourceData: imageSource, width: targetWidth }) => {
      const image = new Image();
      image.src = imageSource;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = Math.round((image.height / image.width) * targetWidth);
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/webp", 0.84);
    }, { sourceData, width });
    if (!dataUrl.startsWith("data:image/webp")) {
      throw new Error("Chromium does not support WebP canvas encoding");
    }
    writeFileSync(output, Buffer.from(dataUrl.split(",")[1], "base64"));
  } finally {
    await page.close();
  }
}

const browser = await chromium.launch({ headless: true });
try {
  for (const asset of sources) {
    const sourceData = `data:image/png;base64,${readFileSync(asset.source).toString("base64")}`;
    for (const width of widths) {
      const resizedPng = path.join(tempDir, `${asset.name}-${width}.png`);
      const avif = path.join(asset.outputDir, `${asset.name}-${width}.avif`);
      const webp = path.join(asset.outputDir, `${asset.name}-${width}.webp`);
      execFileSync("sips", ["--resampleWidth", String(width), asset.source, "--out", resizedPng], { stdio: "ignore" });
    execFileSync("sips", ["-s", "format", "avif", resizedPng, "--out", avif], { stdio: "ignore" });
      await encodeWebp(browser, sourceData, webp, width);
      console.log(`website image variants: ${asset.name}-${width}.avif + ${asset.name}-${width}.webp`);
    }
  }
} finally {
  await browser.close();
  rmSync(tempDir, { recursive: true, force: true });
}
