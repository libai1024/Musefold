# Musefold v1.4 技术选型与决策

> **状态**：v1.4 选型冻结
>
> **日期**：2026-08-22
>
> **目的**：把「Awwwards 级 UI」收成可执行、可回滚的工程决策，避免在实现期重开配色、字体、动效库和官网形态

v1.4 **不重开** Electron / Fastify / Vite / React 18 / npm / TanStack Query。那些是 v1.2.2 / v1.3 的冻结。本文件只处理视觉层会碰到的选型。

## 0. 冻结结论

| 决策点 | 结论 | 类型 |
|---|---|---|
| D1 双寄存器 | 每个表面声明 `theater` 或 `operate`；token 与约束按寄存器分叉，品牌世界不分叉 | 新增 |
| D2 样式体系统一 | Web 迁入 Tailwind v4 + `packages/ui` token；删除 `apps/web/src/styles.css` 里与 token/原语重复的规则 | 解冻 v1.3 遗留 |
| D3 动效库 | Operate：CSS token。Theater 与朱点：GSAP + `@gsap/react`（已在桌面）。禁止同一组件树混用 GSAP 与 Motion | 重估后保留 GSAP |
| D4 3D / WebGL | 默认不引入 Three.js。官网签名画面用 CSS/SVG mask + 图像 | 拒绝 |
| D5 字体 | Operate 继续系统栈。Theater 自托管一款 sans display + Noto Sans SC 子集。禁止 Inter | 新增分叉 |
| D6 图标 | 维持 Lucide 单入口。官网 sprite 同源。禁止第二图标库 | 重申 |
| D7 表情符号 | 产品与官网零 emoji；ESLint / 守卫测试强制 | 新增门禁 |
| D8 官网形态 | 保留 `website/Musefold/` 静态站点 + 动效岛，不并入 `apps/web` SPA | 保留并升级 |
| D9 视觉门禁 | Operate 每张卡更新对应 surface 基线；Theater 官网另开 Lighthouse + 几何契约，不进像素比对 | 修订流程 |
| D10 图像 | 真截图 + 真生成图 + 用户当前图。禁止生成装饰背景、禁止假 UI | 新增 |
| D11 品牌色 | 不改 Graphite / Ember hex。高级感不靠换色 | 冻结 |
| D12 产品版本 | 用户可见切割为 0.6.0；文档版本 v1.4 | 新增 |
| D13 约束修订 | v0.2.2 UI 约束对 Operate 全有效；Theater 例外必须登记在案，不得渗回 | 修订 |
| D14 范围 | 只改可见 UI 与样式基础设施；不改契约、IPC、schema、计费 | 冻结 |

## 1. 约束

- 维护主体仍是小团队。Theater 可以激进，Operate 必须可逐面回滚。
- `packages/product-ui` 仍被双端消费，且被像素级视觉门禁锁定。改它等于同时改桌面和 Web。
- 朱点已用 GSAP。再引入 Motion（`motion/react`）必须隔离在从未 import GSAP 的叶子文件。默认不引入。
- 中文是主界面语言。任何 display 字体方案必须先证明 CJK 回落不破行、不裁 descender、不把中文挤成第二风格。
- v1.2.1 发布分层不变：官网仍是内容层静态资源；桌面 renderer 仍可热更新；外壳层仍走 tag。

## 2. D1 双寄存器

把 Awwwards 简报直接扣在工作台上，会破坏 v0.2 起的 Operate 纪律（密度 7、动效 3、禁止内容区玻璃）。把简报只留给官网，产品会继续「正确但不被记住」。

**结论**：表面分级，不是两套品牌。实现是根节点属性 + token 作用域：

```css
[data-ui-register="operate"] { /* 现有 token */ }
[data-ui-register="theater"] { /* 字阶、时长、间距覆盖；颜色仍引用同一 --accent */ }
```

引导全页、官网 `<body>`、工作台空态与「第一张图」完成层标 theater。AppShell、设置、列表、Composer 标 operate。生成完成是 **800ms 以内的 theater 瞬间**，动画结束后 DOM 回到 operate 结果行，不把时间线改成画廊站点。

不采用：全局把 `MOTION_INTENSITY` 拉到 8。

## 3. D2 Web 样式统一

现状：桌面 Tailwind v4 + `tokens.css`；Web `apps/web/src/styles.css` 约 1,228 行手写，与 token 平行。共享视觉门禁只比像素，不比实现。v1.3 已写触发条件，本版本满足。

**结论**：`apps/web` 接入与桌面相同的 Tailwind v4 与 `@musefold/ui` token。宿主只留极少布局胶水（键盘 inset、导航抽屉）。product-ui 继续只出 `mf-*` 与 token 类。

不采用：把桌面改回手写 CSS；引入 shadcn/ui（内部原语库已被门禁锁定）。

风险：统一过程中像素会抖。必须 **先 WEB-01 迁样式、视觉门禁仍按旧像素绿**，再在 OPERATE 卡里故意改外观并重打基线。禁止「迁 CSS 的同时改设计」。

## 4. D3 动效库

| 候选 | 评估 |
|---|---|
| 继续 CSS token | Operate 足够；官网滚动叙事不够 |
| GSAP + ScrollTrigger | 桌面已有朱点与 `@gsap/react`；官网可用同一家族；必须 `ctx.revert()` |
| Motion (`motion/react`) | 布局过渡友好，但与 GSAP 抢帧；再加一个运行时依赖对 product-ui 不划算 |
| CSS scroll-driven animations | 好，但 Safari / Electron 覆盖仍要 fallback；官网主叙事不拿它当唯一实现 |

**结论**：不引入 Motion。Theater 叶子用 GSAP。Operate 用 CSS。官网滚动叙事用 GSAP ScrollTrigger，打成独立 IIFE / ESM 岛，不把 React 打进官网。

GSAP 标准许可已在桌面第三方声明中。官网若用 GSAP，必须同步 `third-party-notices` 与官网页脚许可，不得默默加。

## 5. D4 拒绝 Three.js 作为默认

签名画面用图像蒙版 + 折页变换已经能到 SOTD 制作精度。Three.js 的包体、能耗、减少动效降级、以及「AI 作品用 WebGL 粒子」的评审偏见，对本品牌是负分。

复审触发器：若未来要做「在 3D 里翻一本作品集」且有专人维护，单独立项，不塞进 v1.4。

## 6. D5 字体分叉

产品继续系统字体：原生、零下载、CJK 最佳。官网 / 引导若也 13px SF Pro，则永远像后台管理。

**结论**：Theater 自托管 display + Noto Sans SC subset。文件放 `website/Musefold/assets/fonts/` 与 `packages/ui/fonts/`（引导复用）。`font-display: swap`。禁止 Google Fonts 运行时 `<link>`。

锁定前必须在 macOS / Windows 上看中文标题「让灵感成为图像。」：不破行、Ember 强调词不换字体家族。

## 7. D6 / D7 图标与 emoji

Lucide 已是全仓唯一图标实现。v1.4 只补官网同源 sprite，以及 emoji 机器门禁。

守卫范围：

- `apps/desktop/src/**/*.{tsx,ts,css}`
- `apps/web/src/**/*.{tsx,ts,css}`
- `packages/ui/**/*.{tsx,ts,css}`
- `packages/product-ui/**/*.{tsx,ts,css}`
- `website/Musefold/**/*.{html,css,js}`

允许：单元测试夹具里描述「用户输入了 emoji」的字符串；第三方许可文本。

`Sparkles` 在 Lucide 里是合法图标，不是 emoji。引导「第一张图」若用 `Sparkles`，语义是「显形」，不要换成 ✨。

## 8. D8 官网保持静态站点

`apps/web` 是登录后的工作台 SPA，还是未来 Capacitor 的底。官网是未登录的叙事与下载。两者 CSP、缓存、发布路径都不同。

**结论**：继续 `website/Musefold/`。升级为：语义 HTML + `styles.css` + 一个 `motion.js` 岛（GSAP）。需要 Lucide sprite 时用仓库脚本生成，不在浏览器跑 React。

不采用：Next.js 营销站；把落地页路由塞进 Web SPA。

## 9. D9 视觉门禁协议

像素门禁是双端一致的执行机制（v1.2.2 D1 保留 Electron 的理由之一）。v1.4 会故意改像素，所以协议必须先于改外观：

1. Phase 1 的 CSS 统一：**零视觉变更**，旧基线必须绿。
2. 每张 OPERATE / THEATER（产品内）卡：只动声明的 surface，更新 `scripts/compare-shared-ui-visuals.mjs` 对应截图产物与阈值说明。
3. 阈值不得偷偷放宽。若 mean error 需要上调，卡内写明原因，收口阶段再压回。
4. 官网不进 `test:visual:shared`。官网验收 = Playwright 几何契约（无横向溢出、CTA 可见、390/768/1440）+ Lighthouse CI（LCP < 2.5s、CLS < 0.1）。

## 10. D10 图像材料

多模态可用，但品牌禁止「装饰性 AI 图形」。v1.4 只接受三类图，见[视觉方向 §4](./V14-UI-DIRECTION.md)。

截图刷新排在 Phase 4 之后、Phase 5 切割之前：先改产品，再拍官网证据图，避免官网仍展示 0.5 铬。

## 11. D11 / D12 色与版本

换色是最廉价也最像「又做了一版 AI UI」的动作。Ember 已与朱点、主按钮、焦点环绑死。

对外版本 0.6.0：这是用户能看见的第一刀，必须和「还是 0.5 只是架构更好」切开。桌面包 `version`、官网 JSON-LD `softwareVersion`、下载 catalog、关于页同步。热更新 `minShellVersion` 是否抬升：若只改 renderer / 官网，按 v1.2.1 内容层发布，不抬外壳；若动了主进程窗口材质再另议。默认 **不抬 minShellVersion**。

## 12. D13 修订 v0.2.2 约束的方式

不得在业务 CSS 里悄悄打破「禁止渐变表面 / 禁止内容区 blur」。Theater 例外写进 `docs/v0.2/V02.2-UI-DEVELOPMENT-CONSTRAINTS.md` 新增 §0.1：

- 适用：`[data-ui-register="theater"]` 及其子树
- 仍禁止：emoji、第二图标库、第二品牌色、内容区假玻璃（引导完成层用实色或图像，不用 blur 叠内容）
- 允许：更大字阶、更长时长、图像蒙版、一次滚动叙事（仅官网）

Operate 子树继续原约束全文。

## 13. D14 不做的事

- ENT-B、pnpm、React 19、Tauri
- 新表单库、新状态库
- 把 design-schemes 与 generation 合并
- 为共享而把桌面独有能力搬到 Web
- 改主导航信息架构与 v0.2.2 术语表

## 14. 复审触发器

| 触发 | 动作 |
|---|---|
| Theater 字体在 Windows 上 CJK 不可用 | 立刻回退系统栈，只保留字阶 |
| GSAP 官网包体打满 LCP | 改 CSS scroll-driven + 静态折页，去掉滚动劫持 |
| 视觉门禁因抗锯齿持续误报 | 不放宽阈值，先查 fixture 窗口与字体加载 |
| 产品内 Theater 瞬间造成 E2E 抖动 | 动画结束发 `animationend` / 测试钩 `data-theater-idle` |
