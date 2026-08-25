import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageHeader = readFileSync("apps/desktop/src/components/layout/PageHeader.tsx", "utf8");
const titleBar = readFileSync("apps/desktop/src/components/layout/TitleBar.tsx", "utf8");
const productTopbar = readFileSync(
  "packages/product-ui/src/navigation/ProductTopbar.tsx",
  "utf8",
);
const settingsView = readFileSync(
  "apps/desktop/src/features/settings/components/SettingsView.tsx",
  "utf8",
);
const workbench = readFileSync(
  "apps/desktop/src/features/generation/workbench/WorkbenchTimeline.tsx",
  "utf8",
);
const emptyState = readFileSync(
  "packages/product-ui/src/workbench/WorkbenchEmptyState.tsx",
  "utf8",
);
// 品牌信息已并入「关于」分区（v0.3.2 设置重构）
const aboutSection = readFileSync(
  "apps/desktop/src/features/settings/components/AboutSection.tsx",
  "utf8",
);

describe("single page identity contract", () => {
  it("keeps the page identity in the top title bar only", () => {
    expect(titleBar).toContain("<ProductTopbar");
    expect(productTopbar).toContain('data-testid={titleTestId}');
    expect(pageHeader).not.toContain("<h1");
    expect(settingsView).not.toContain("偏好与连接");
    expect(settingsView).not.toContain("<PageHeader");
  });

  it("renders secondary page chrome only when controls exist", () => {
    expect(pageHeader).toContain("if (typeof count !==");
    expect(pageHeader).toContain('data-testid="page-toolbar"');
  });

  it("uses the shared logo lockup on the new conversation and merged about surfaces", () => {
    expect(workbench).toContain("<WorkbenchEmptyState");
    // v2.0(11 §4):空态品牌锁定区由共享层内置 MusefoldMark + 名称 + 提示语,
    // 不再有 data-brand-hero 大插画插槽。
    expect(emptyState).toContain("MusefoldMark");
    expect(emptyState).toContain('data-testid="workbench-empty-brand"');
    expect(aboutSection).toContain("<MusefoldLogoAnimated");
    expect(workbench).not.toContain("job-msna7heh-3.png");
    expect(aboutSection).not.toContain("job-msna7heh-3.png");
  });
});
