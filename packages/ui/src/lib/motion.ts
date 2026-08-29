/**
 * 动效分级的 JS 侧判定(与 globals.css 压制规则同一语义,MotionSync 挂标记):
 * CSS 动画由压制规则兜底;JS 驱动的动效(rAF 编排、入场 reveal、marquee 起停)
 * 在启动前调用本函数,命中时直接置终态,不做任何帧工作——省的不只是视觉,还有算力。
 */
export function skipMotion(): boolean {
  if (typeof document === 'undefined') return true;
  const root = document.documentElement;
  if (root.classList.contains('reduce-motion')) return true;
  if (root.dataset.motion === 'off') return false;
  // system(或首帧未挂标记):跟随系统偏好;无法探测(SSR 后首帧/jsdom)时直接置终态。
  if (typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
