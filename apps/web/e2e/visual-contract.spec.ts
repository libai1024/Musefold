import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
      })),
    )
    .toEqual(
      await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.clientWidth,
        bodyWidth: document.documentElement.clientWidth,
      })),
    );
}

async function captureCanonicalSurface(
  page: Page,
  testInfo: TestInfo,
  name: string,
  testId: string,
): Promise<void> {
  const surface = page.getByTestId(testId);
  await expect(surface).toBeVisible();
  // v2.0:新对话空态为无入场动画的品牌锁定区,可见即可拍(11 §7)。
  if (testId === "generation-result-group") {
    // THEATER-04：结果面截图必须等显形落定后再拍。
    const results = page.locator(".mf-generation-result-surface");
    const count = await results.count();
    for (let index = 0; index < count; index += 1) {
      await expect(results.nth(index)).toHaveAttribute(
        "data-theater-idle",
        "true",
      );
    }
  }
  if (testId === "prompt-reference-preview") {
    await surface.evaluate((element) => {
      (element as HTMLElement).style.animation = "none";
    });
  }
  // 水印呼吸、字幕慢滚与 Ember 点脉动会让双端截图落在不同相位,拍摄前冻结。
  const animated = page.locator(
    ".mf-workbench-empty-watermark-word span, .mf-workbench-direction-track, .mf-workbench-empty-brand svg circle",
  );
  if ((await animated.count()) > 0) {
    await animated.evaluateAll((elements) => {
      for (const element of elements) {
        (element as HTMLElement).style.animation = "none";
      }
    });
  }
  const metrics = await surface.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  expect(metrics.width).toBeGreaterThan(0);
  expect(metrics.height).toBeGreaterThan(0);
  expect(metrics.left).toBeGreaterThanOrEqual(-1);
  expect(metrics.right).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(metrics.top).toBeGreaterThanOrEqual(-1);
  expect(metrics.top).toBeLessThan(metrics.viewportHeight);
  await expectNoHorizontalOverflow(page);

  const screenshot = await page.screenshot();
  await testInfo.attach(`web-${name}`, {
    body: screenshot,
    contentType: "image/png",
  });
  const outputDir = process.env.MUSEFOLD_VISUAL_OUTPUT_DIR;
  if (outputDir) {
    await mkdir(outputDir, { recursive: true });
    await page.screenshot({ path: join(outputDir, `web-${name}.png`) });
    const sharedFileName: string | undefined = (
      {
        "workbench-1440-light-comfortable": "shared-workbench-1440x900.png",
        "product-sidebar-1440-light-comfortable":
          "shared-product-sidebar-1440x900.png",
        "workbench-composer-1440-light-comfortable":
          "shared-workbench-composer-1440x900.png",
        "workbench-composer-390-light-comfortable":
          "shared-workbench-composer-390x844.png",
        "workbench-result-1440-light-comfortable":
          "shared-workbench-result-1440x900.png",
        "workbench-result-failed-1440-light-comfortable":
          "shared-workbench-result-failed-1440x900.png",
        "workbench-result-cancelled-1440-light-comfortable":
          "shared-workbench-result-cancelled-1440x900.png",
        "workbench-result-cancelled-390-light-comfortable":
          "shared-workbench-result-cancelled-390x844.png",
        "library-list-1440-light-comfortable":
          "shared-library-list-1440x900.png",
        "prompt-detail-1440-light-comfortable":
          "shared-prompt-detail-1440x900.png",
        "prompt-reference-card-1440-light-comfortable":
          "shared-prompt-reference-card-1440x900.png",
        "prompt-reference-preview-1440-light-comfortable":
          "shared-prompt-reference-preview-1440x900.png",
        "history-workspace-1440-light-comfortable":
          "shared-history-workspace-1440x900.png",
      } as Record<string, string>
    )[name];
    if (sharedFileName) {
      await surface.screenshot({
        path: join(outputDir, sharedFileName),
      });
    }
    if (name === "history-detail-1440-light-comfortable") {
      const content = page.getByTestId("history-detail-content");
      await content.evaluate((element) => {
        element.setAttribute("data-density", "compact");
      });
      await content.getByTestId("history-detail-image").evaluate((element) => {
        element.replaceChildren();
      });
      await content.screenshot({
        path: join(outputDir, "shared-history-detail-compact.png"),
      });
    }
    if (name === "account-1440-light-comfortable") {
      const accountSummary = page.getByTestId("account-summary-panel");
      await accountSummary
        .locator(".mf-account-summary-footer")
        .evaluate((element) => {
          (element as HTMLElement).style.display = "none";
        });
      await accountSummary.screenshot({
        path: join(outputDir, "shared-account-summary-1440x900.png"),
      });
    }
    if (name === "connected-apps-1440-light-comfortable") {
      await surface.screenshot({
        path: join(outputDir, "shared-connected-apps-1440x900.png"),
      });
    }
  }
}

async function openFixture(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto("./");
  await expect(page.getByTestId("generation-workbench")).toBeVisible();
  await expect(page.getByText("开发预览", { exact: true })).toBeVisible();
}

async function openCompactSidebar(page: Page): Promise<void> {
  const layout = page.getByTestId("product-sidebar-layout");
  const rail = page.getByTestId("product-sidebar-rail");
  await expect(layout).toHaveAttribute("data-compact", "true");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const toggle = page.getByRole("button", { name: "展开侧栏" });
  if ((await rail.count()) === 0) {
    await toggle.click();
  }
  await expect(rail).toHaveAttribute("data-open", "true");
  await expect(page.getByTestId("product-sidebar")).toBeVisible();
}

test("canonical Desktop/Web surfaces stay within the shared visual contract", async ({
  page,
}, testInfo) => {
  const browserErrors = collectBrowserErrors(page);
  await openFixture(page, 1440, 900);
  await page.getByTestId("sidebar-resize-handle").dblclick();
  await captureCanonicalSurface(
    page,
    testInfo,
    "product-sidebar-1440-light-comfortable",
    "product-sidebar",
  );
  await captureCanonicalSurface(
    page,
    testInfo,
    "workbench-1440-light-comfortable",
    "generation-workbench",
  );
  await captureCanonicalSurface(
    page,
    testInfo,
    "workbench-composer-1440-light-comfortable",
    "workbench-composer-surface",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await captureCanonicalSurface(
    page,
    testInfo,
    "workbench-composer-390-light-comfortable",
    "workbench-composer-surface",
  );
  await page.setViewportSize({ width: 1440, height: 900 });

  await page
    .getByTestId("product-sidebar")
    .getByRole("button", { name: "提示词库" })
    .click();
  await captureCanonicalSurface(
    page,
    testInfo,
    "library-list-1440-light-comfortable",
    "library-page",
  );

  await page
    .locator('[data-prompt-id="prompt-night-architecture"]')
    .getByTestId("prompt-row-open")
    .click();
  await captureCanonicalSurface(
    page,
    testInfo,
    "prompt-detail-1440-light-comfortable",
    "prompt-detail",
  );

  await page.getByTestId("detail-generate").click();
  await captureCanonicalSurface(
    page,
    testInfo,
    "prompt-reference-card-1440-light-comfortable",
    "refine-source",
  );
  await page.getByTestId("refine-source-clear").focus();
  await expect(page.getByTestId("prompt-reference-preview")).toBeVisible();
  await page.waitForTimeout(180);
  await captureCanonicalSurface(
    page,
    testInfo,
    "prompt-reference-preview-1440-light-comfortable",
    "prompt-reference-preview",
  );
  await expect(page.getByLabel("生成图片")).toBeEnabled();
  await page.getByLabel("生成图片").click();
  await expect(page.getByTestId("generation-result-surface")).toHaveAttribute(
    "data-status",
    "success",
    { timeout: 8_000 },
  );
  await expect(page.locator(".generated-asset")).toBeVisible({
    timeout: 8_000,
  });
  await captureCanonicalSurface(
    page,
    testInfo,
    "workbench-result-1440-light-comfortable",
    "generation-result-group",
  );
  await page
    .getByTestId("product-sidebar")
    .getByRole("button", { name: "生成历史" })
    .click();
  await page
    .getByTestId("history-row")
    .getByRole("button", { name: "打开" })
    .click();
  await expect(page.getByTestId("history-inspector")).toHaveCSS(
    "width",
    "320px",
  );
  await page
    .getByTestId("history-workspace")
    .locator("img")
    .evaluateAll((images) => images.forEach((image) => image.remove()));
  await captureCanonicalSurface(
    page,
    testInfo,
    "history-workspace-1440-light-comfortable",
    "history-workspace",
  );
  await captureCanonicalSurface(
    page,
    testInfo,
    "history-detail-1440-light-comfortable",
    "history-detail",
  );
  await page.getByTestId("history-detail-close").click();
  await expect(page.getByTestId("history-workspace")).toHaveAttribute(
    "data-detail-open",
    "false",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await openCompactSidebar(page);
  await page.locator("[data-conversation-row]").first().click();
  await captureCanonicalSurface(
    page,
    testInfo,
    "workbench-390-light-comfortable",
    "generation-workbench",
  );
  await openCompactSidebar(page);
  await page.getByTestId("product-sidebar").getByTestId("nav-prompts").click();
  await captureCanonicalSurface(
    page,
    testInfo,
    "library-list-390-light-comfortable",
    "library-page",
  );

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId("sidebar-account").click();
  await captureCanonicalSurface(
    page,
    testInfo,
    "account-1440-light-comfortable",
    "account-screen",
  );
  await page
    .getByRole("navigation", { name: "设置分区" })
    .getByRole("button", { name: "已连接应用" })
    .click();
  await captureCanonicalSurface(
    page,
    testInfo,
    "connected-apps-1440-light-comfortable",
    "connected-apps-screen",
  );

  expect(browserErrors).toEqual([]);
});

test("generation result failure and cancellation states stay shared across viewports", async ({
  page,
}, testInfo) => {
  const browserErrors = collectBrowserErrors(page);
  await openFixture(page, 1440, 900);

  await page.getByTestId("generation-composer-prompt").fill("视觉回归模拟失败");
  await page.getByLabel("生成图片").click();
  await expect(
    page.locator('.mf-generation-result-surface[data-status="failed"]'),
  ).toBeVisible({ timeout: 8_000 });
  await captureCanonicalSurface(
    page,
    testInfo,
    "workbench-result-failed-1440-light-comfortable",
    "generation-result-group",
  );

  await openFixture(page, 1440, 900);
  await page.getByTestId("generation-composer-prompt").fill("视觉回归模拟取消");
  await page.getByLabel("生成图片").click();
  await page.getByLabel("取消生成").click();
  await expect(
    page.locator('.mf-generation-result-surface[data-status="cancelled"]'),
  ).toBeVisible({ timeout: 8_000 });
  await captureCanonicalSurface(
    page,
    testInfo,
    "workbench-result-cancelled-1440-light-comfortable",
    "generation-result-group",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await captureCanonicalSurface(
    page,
    testInfo,
    "workbench-result-cancelled-390-light-comfortable",
    "generation-result-group",
  );
  expect(browserErrors).toEqual([]);
});
