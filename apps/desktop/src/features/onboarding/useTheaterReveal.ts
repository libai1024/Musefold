import { useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { useAppStore } from '../../stores/app';

gsap.registerPlugin(useGSAP);

export function theaterReducedMotion(
  preference: ReturnType<typeof useAppStore.getState>['reducedMotion'],
): boolean {
  if (preference === 'on') return true;
  if (preference === 'off') return false;
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function markTheaterIdle(node: HTMLElement | null) {
  if (!node || node.dataset.theaterIdle === 'true') return;
  node.dataset.theaterIdle = 'true';
  node.dispatchEvent(new Event('animationend', { bubbles: true }));
}

function durationSeconds(node: HTMLElement, token: string, fallbackMs: number): number {
  const raw = getComputedStyle(node).getPropertyValue(token).trim();
  const ms = Number.parseFloat(raw);
  return Number.isFinite(ms) && ms > 0 ? ms / 1000 : fallbackMs / 1000;
}

export function clearTheaterIdle(node: HTMLElement | null) {
  if (!node) return;
  delete node.dataset.theaterIdle;
}

/** Welcome-step 显形编排。卸载走 useGSAP 的 context revert。 */
export function useTheaterReveal() {
  const rootRef = useRef<HTMLElement>(null);
  const reducedMotion = useAppStore((s) => s.reducedMotion);

  useGSAP(() => {
    const root = rootRef.current;
    if (!root) return;

    if (theaterReducedMotion(reducedMotion)) {
      markTheaterIdle(root);
      return;
    }

    root.dataset.theaterReady = 'true';
    const enter = durationSeconds(root, '--dur-theater-enter', 640);
    const fold = durationSeconds(root, '--dur-theater-fold', 900);
    const timeline = gsap.timeline({
      defaults: { ease: 'power3.out' },
      onComplete: () => markTheaterIdle(root),
    });

    timeline
      .from('[data-theater-mark]', {
        autoAlpha: 0,
        x: 28,
        rotateY: -52,
        transformPerspective: 1400,
        transformOrigin: '100% 12%',
        duration: fold,
      })
      .from('[data-theater-line]', {
        yPercent: 108,
        duration: enter,
        stagger: 0.08,
      }, `-=${fold * 0.55}`)
      .from('[data-theater-cta]', {
        autoAlpha: 0,
        y: 12,
        duration: 0.42,
        ease: 'back.out(1.35)',
      }, `-=${enter * 0.45}`);

    return () => {
      timeline.revert();
    };
  }, { scope: rootRef, dependencies: [reducedMotion] });

  return { rootRef };
}

/** 第一张图显形：`--dur-theater-hold` 内完成图就位 + 朱点停驻。生成中清掉 idle，避免 E2E 误判。 */
export function useFirstImageReveal({
  imageReady,
  generating,
}: {
  imageReady: boolean;
  generating: boolean;
}) {
  const rootRef = useRef<HTMLElement>(null);
  const reducedMotion = useAppStore((s) => s.reducedMotion);

  useGSAP(() => {
    const root = rootRef.current;
    if (!root) return;

    if (generating) {
      clearTheaterIdle(root);
      return;
    }

    if (!imageReady || theaterReducedMotion(reducedMotion)) {
      markTheaterIdle(root);
      return;
    }

    clearTheaterIdle(root);
    const hold = durationSeconds(root, '--dur-theater-hold', 1200);
    const image = root.querySelector('[data-theater-image]');
    const stamp = root.querySelector('[data-theater-stamp]');
    if (!image) {
      markTheaterIdle(root);
      return;
    }

    gsap.set(image, { autoAlpha: 0, scale: 1.04, y: 16 });
    if (stamp) gsap.set(stamp, { autoAlpha: 0, scale: 0 });

    const timeline = gsap.timeline({
      defaults: { ease: 'power3.out' },
      onComplete: () => markTheaterIdle(root),
    });
    timeline.to(image, {
      autoAlpha: 1,
      scale: 1,
      y: 0,
      duration: hold * 0.72,
      transformOrigin: '50% 50%',
    });
    if (stamp) {
      timeline.to(stamp, {
        autoAlpha: 1,
        scale: 1,
        duration: hold * 0.28,
        ease: 'back.out(2)',
        transformOrigin: '50% 50%',
      }, `-=${hold * 0.12}`);
    }

    return () => {
      timeline.revert();
    };
  }, { scope: rootRef, dependencies: [imageReady, generating, reducedMotion] });

  return { rootRef };
}

