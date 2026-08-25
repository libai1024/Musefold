import { useEffect, useRef, useState } from "react";
import { skipTheaterMotion, theaterDurationMs } from "./useTheaterIdle";

export type ResultRevealDecision = "idle" | "reveal";

/** 结果就位决策：只有挂载后「无图 → 有图」的转场才显形；静态挂载与减少动效直接 idle。 */
export function resultRevealDecision(
  becameAvailable: boolean,
  skipMotion: boolean,
): ResultRevealDecision {
  return becameAvailable && !skipMotion ? "reveal" : "idle";
}

/**
 * THEATER-04 结果就位：图可用的一瞬 scale/opacity 落定（--dur-theater-enter ≤ 800ms），
 * 结束后移除 theater 属性，DOM 回到 Operate 结果行。共享层不引 GSAP。
 */
export function useResultTheaterReveal(imageAvailable: boolean) {
  const [revealing, setRevealing] = useState(false);
  const [idle, setIdle] = useState(false);
  const wasAvailable = useRef(imageAvailable);
  const mediaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const becameAvailable = !wasAvailable.current && imageAvailable;
    wasAvailable.current = imageAvailable;
    if (resultRevealDecision(becameAvailable, skipTheaterMotion()) === "idle") {
      setIdle(true);
      return;
    }
    // pending 期间已打的 idle 必须清掉，否则钩子会在显形中途误报就位。
    setIdle(false);
    setRevealing(true);
  }, [imageAvailable]);

  useEffect(() => {
    if (!revealing) return;
    const node = mediaRef.current;
    const raw = node
      ? getComputedStyle(node).getPropertyValue("--dur-theater-enter").trim()
      : "";
    const timer = window.setTimeout(
      () => {
        setRevealing(false);
        setIdle(true);
      },
      theaterDurationMs(raw) + 80,
    );
    return () => window.clearTimeout(timer);
  }, [revealing]);

  return { revealing, idle, mediaRef };
}
