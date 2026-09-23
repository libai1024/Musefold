/**
 * vitest 全局 setup(2026-09 走查 P2 tooltip 推广引入):
 * jsdom 没有 ResizeObserver,而 Radix popper 在量 Arrow 尺寸时会 `new ResizeObserver`
 * (`@radix-ui/react-use-size`)——对话框打开时自动聚焦 tooltip 触发钮、tooltip 随焦点
 * 挂载内容,测试即崩。用最小 no-op polyfill 补齐;布局断言不依赖真实回调。
 */
class ResizeObserverPolyfill {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverPolyfill as unknown as typeof ResizeObserver;
}
