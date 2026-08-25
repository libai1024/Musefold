# apps/web — Web 端开发约束

Web SPA,手机浏览器优先的薄宿主。核心原则:**编排与组件尽可能复用 product-ui,宿主只做路由挂载、平台胶水与 Web 特有页面**。渲染层通用规范见 `docs/frontend/DEVELOPMENT-GUIDE.md`。

## 结构与数据

```text
src/views/        页面(编排交给 product-ui page-controllers,不重写过滤/分页/错误处理)
src/screens/      启动/引导等 Web 特有屏
src/layout/       WebNavigation 等宿主壳
src/runtime/      cloud-gateway(实现 domain 端口,与桌面 desktop-gateway 平行)
```

- 数据只走 `cloud-client`(经 runtime gateway 实现 domain 端口)→ TanStack Query。禁依赖 `desktop-contracts` / `core` / electron(depcruise `web-no-desktop`)。
- 状态分工、query 约定、表单范式全部按 DEVELOPMENT-GUIDE §3a/§4 执行,双端一致。

## 样式与断点

- 断点两档,职责分明,不要混写:
  - **680px = `PRODUCT_MOBILE_BREAKPOINT`**(移动布局/触控字号/键盘 inset),宿主 `styles.css` 的媒体块负责;
  - **760px COMPACT**(侧栏折叠)由 product-ui 自己的媒体查询负责,宿主不要重复实现。
- Web 现状是手写 CSS(v1.4 Phase 1 已按批次统一);新组件优先复用 product-ui(其样式来自 `@musefold/ui` token 类),避免再造本地 CSS 体系;token 单源在 `packages/ui/src/tokens.css`,不硬编码色值/字号。
- 图标唯一入口 `@musefold/ui` icons。

## 测试与门禁

- `npm run check:v1.1`(共享 UI 边界 + v1.1 栈 typecheck/test + `check:production`)。
- `npm run test:e2e:web`(Playwright:`mobile` / `workspace` / `visual-contract`)。
- 触及共享面跑 `npm run test:visual:shared`(双端像素门禁);Web 自身样式重构用 `node scripts/diff-web-visuals.mjs capture|compare` 前后对比。
- fixtures 模式本地开发:`npm run dev:web:fixtures`。

## 边界提醒

- 不要为「未来 Capacitor iOS」提前抽象——SPA 选型已是冻结决策,复用靠 product-ui 完成,不靠宿主层预留。
- Web 不做桌面能力的降级模拟:桌面特有功能在 Web 就是不可用,按 capability(见 `packages/domain`)判断,不写平台探测 hack。
