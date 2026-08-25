import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const tokensPath = join(dirname(fileURLToPath(import.meta.url)), "..", "tokens.css");
const tokens = readFileSync(tokensPath, "utf8");
const darkBlock = tokens.slice(tokens.indexOf('[data-theme="dark"]'));

/**
 * v2.0 Phase A(docs/v2.0/ui-design/09 §20):
 * 新增 2.0 语义 token,旧 token 仍兼容;Light/Dark 表面层级一致。
 */
describe("v2.0 semantic tokens", () => {
  it("declares the surface layer in both themes without removing legacy tokens", () => {
    for (const name of [
      "--surface-window",
      "--surface-sidebar",
      "--surface-work",
      "--surface-raised",
      "--surface-inset",
      "--surface-popover",
      "--surface-media",
    ]) {
      expect(tokens).toContain(`${name}:`);
    }
    // 旧 token 继续解析,存量组件零回归。
    for (const legacy of [
      "--bg-window:",
      "--bg-sidebar:",
      "--bg-elevated:",
      "--bg-popover:",
      "--bg-inset:",
      "--radius-sm:",
      "--radius-lg:",
    ]) {
      expect(tokens).toContain(legacy);
    }
    // 深色下媒体承托面必须亮于 raised,图片结果不沉入背景(00 §3)。
    expect(darkBlock).toContain("--surface-media: #2a2c30");
  });

  it("declares shell geometry, gap, radius and dialog shadow tokens", () => {
    for (const declaration of [
      "--bg-work:",
      "--bg-dock:",
      "--shell-sidebar-width: 248px",
      "--shell-sidebar-min-width: 220px",
      "--shell-dock-width: 304px",
      "--gap-shell: 1px",
      "--gap-surface-inset: 4px",
      "--gap-content: 8px",
      "--gap-section: 16px",
      "--gap-page: 24px",
      "--radius-tooltip: 6px",
      "--radius-control: 8px",
      "--radius-work: 12px",
      "--radius-media: 14px",
      "--radius-dialog: 16px",
      "--radius-theater: 20px",
      "--border-focus:",
    ]) {
      expect(tokens).toContain(declaration);
    }
  });

  it("keeps the three shadow tiers theme-aware without colored glow", () => {
    expect(tokens).toContain("--shadow-dialog: 0 24px 70px rgba(20, 20, 24, 0.16)");
    expect(darkBlock).toContain("--shadow-dialog: 0 28px 80px rgba(0, 0, 0, 0.62)");
    // 深色只提高阴影不透明度,不引入彩色 glow。
    expect(darkBlock).not.toMatch(/box-shadow|shadow[^;]*var\(--accent\)/);
  });
});
