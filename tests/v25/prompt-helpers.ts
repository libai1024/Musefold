import { expect, type Locator, type Page } from '@playwright/test';

/** 定位包含指定标题的库列表行。 */
export function promptRow(page: Page, title: string): Locator {
  return page.getByTestId('prompt-grid').locator('article', { hasText: title });
}

/** 行内常驻操作(hover 渐显仅是透明度,Playwright 可直接点击)。 */
export async function clickRowAction(
  page: Page,
  title: string,
  actionTestId: string,
): Promise<void> {
  await promptRow(page, title).getByTestId(actionTestId).click();
}

/** 行点击打开详情 Inspector(md+ 右栏 / 窄屏 Sheet 同一 testid),返回面板定位器。 */
export async function openPromptDetail(page: Page, title: string): Promise<Locator> {
  await promptRow(page, title).getByTestId('prompt-row-open').click();
  const detail = page.getByTestId('prompt-detail');
  await expect(detail).toBeVisible();
  return detail;
}

/** 通过编辑器新建一条提示词并等它出现在列表里。 */
export async function createPrompt(page: Page, title: string, content: string): Promise<void> {
  await page.getByTestId('prompt-create').click();
  await page.getByTestId('prompt-editor-title').fill(title);
  await page.getByTestId('prompt-editor-content').fill(content);
  await page.getByTestId('prompt-editor-submit').click();
  await expect(page.getByTestId('prompt-editor')).toBeHidden();
  await expect(page.getByText(title)).toBeVisible();
}
