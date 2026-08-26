// 验证空态水印:呼吸动画已生效 + 字母 hover 主色高亮可达。
// 前置:npm run dev:web:fixtures(4174 端口)。
import { chromium } from 'playwright';

const URL = 'http://localhost:4174';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="workbench-empty"]', { timeout: 15000 });

const first = page.locator('.mf-workbench-empty-watermark-word span').first();
const before = await first.evaluate((el) => {
  const cs = getComputedStyle(el);
  return { animationName: cs.animationName, opacity: cs.opacity, color: cs.color, fontFamily: cs.fontFamily };
});
console.log('before:', JSON.stringify(before, null, 2));

// 采样两次确认呼吸在动
await page.waitForTimeout(1500);
const mid = await first.evaluate((el) => getComputedStyle(el).opacity);
console.log('opacity 1.5s later:', mid, '(应与 before.opacity 不同)');

// hover 第一个字母(M,在最左侧,不被品牌区覆盖)
const box = await first.boundingBox();
console.log('letter bbox:', JSON.stringify(box));
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
await page.waitForTimeout(300);
const hovered = await first.evaluate((el) => {
  const cs = getComputedStyle(el);
  return { opacity: cs.opacity, color: cs.color, matchesHover: el.matches(':hover') };
});
console.log('hovered:', JSON.stringify(hovered, null, 2));

await page.screenshot({ path: 'artifacts/empty-state-watermark-hover.png' });
await page.mouse.move(40, 700);
await page.waitForTimeout(400);
await page.screenshot({ path: 'artifacts/empty-state-watermark-idle.png' });
await browser.close();
console.log('screenshots: artifacts/empty-state-watermark-{hover,idle}.png');
