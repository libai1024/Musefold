import { useEffect, type RefObject } from "react";

export function markTheaterIdle(node: HTMLElement) {
  if (node.dataset.theaterIdle === "true") return;
  node.dataset.theaterIdle = "true";
  node.dispatchEvent(new Event("animationend", { bubbles: true }));
}

export function skipTheaterMotion(): boolean {
  if (typeof document === "undefined") return true;
  const root = document.documentElement;
  if (root.dataset.motion === "off") return false;
  if (root.classList.contains("reduce-motion") || root.dataset.motion === "on") {
    return true;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** token 文本可能是 "640ms" 或压缩后的 ".64s"，单位必须归一到毫秒。 */
export function theaterDurationMs(raw: string): number {
  const value = raw.trim();
  const ms = Number.parseFloat(value);
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return value.endsWith("s") && !value.endsWith("ms") ? ms * 1000 : ms;
}

/** CSS 入场结束后打 idle 钩。共享层不引 GSAP。 */
export function useTheaterIdle(
  ref: RefObject<HTMLElement | null>,
  extraDelayMs = 0,
) {
  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (skipTheaterMotion()) {
      markTheaterIdle(node);
      return;
    }

    const raw = getComputedStyle(node).getPropertyValue("--dur-theater-enter").trim();
    const duration = theaterDurationMs(raw);
    const timer = window.setTimeout(
      () => markTheaterIdle(node),
      duration + extraDelayMs,
    );
    return () => window.clearTimeout(timer);
  }, [ref, extraDelayMs]);
}
