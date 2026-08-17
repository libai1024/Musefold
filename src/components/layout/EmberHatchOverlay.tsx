// 引首落印 · 飞行覆盖层（v0.3.3 朱点规范 §7）。
// 引导层卸载瞬间，从 logo 圆点原坐标接管一枚朱点，以「运笔的弧」送至保留区落点，
// 抵达即交棒给 EmberMark 本体执行钤印按压。任意点击 / resize 直接跳到终态。
import { useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { useEmberHatchStore } from '../../stores/emberHatch';

gsap.registerPlugin(useGSAP);

const DOT_SIZE = 15;

export function EmberHatchOverlay() {
  const phase = useEmberHatchStore((s) => s.phase);
  const from = useEmberHatchStore((s) => s.from);
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);

  useGSAP(() => {
    if (phase !== 'flying' || !from) return;
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    let raf = 0;
    let frames = 0;
    const start = {
      x: from.x + from.width / 2 - DOT_SIZE / 2,
      y: from.y + from.height / 2 - DOT_SIZE / 2,
      scale: Math.max(0.2, from.width / DOT_SIZE),
    };
    // 先把覆盖点放到起点（引导层刚卸载，这枚点就是视觉上的“同一枚”）
    gsap.set(outer, { x: start.x });
    gsap.set(inner, { y: start.y, scale: start.scale, transformOrigin: '50% 50%' });

    const begin = () => {
      const target = document.querySelector('[data-testid="ember-mark"]');
      if (!target) {
        frames += 1;
        // 落点尚未挂载：等最多 ~1.5s，超时直接落印（不留悬空点）
        if (frames < 90) {
          raf = requestAnimationFrame(begin);
          return;
        }
        useEmberHatchStore.getState().land();
        return;
      }
      const rect = target.getBoundingClientRect();
      const end = {
        x: rect.x + rect.width / 2 - DOT_SIZE / 2,
        y: rect.y + rect.height / 2 - DOT_SIZE / 2,
      };
      // 运笔的弧：横向匀势，纵向先扬后落；全程不弹跳（钤印在落地段由本体完成）
      const lift = Math.max(60, Math.abs(end.x - start.x) * 0.1);
      const timeline = gsap.timeline({
        onComplete: () => useEmberHatchStore.getState().land(),
      });
      timeline
        .to(outer, { x: end.x, duration: 0.9, ease: 'power1.inOut' }, 0)
        .to(inner, { y: Math.min(start.y, end.y) - lift, duration: 0.36, ease: 'power2.out' }, 0)
        .to(inner, { y: end.y, duration: 0.54, ease: 'power2.in' }, 0.36)
        .to(inner, { scale: 1, duration: 0.9, ease: 'power1.inOut' }, 0);
      timelineRef.current = timeline;
    };
    begin();

    const skipToEnd = () => {
      if (timelineRef.current) {
        timelineRef.current.progress(1);
      } else {
        cancelAnimationFrame(raf);
        useEmberHatchStore.getState().land();
      }
    };
    window.addEventListener('pointerdown', skipToEnd, true);
    window.addEventListener('resize', skipToEnd);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointerdown', skipToEnd, true);
      window.removeEventListener('resize', skipToEnd);
      timelineRef.current?.kill();
      timelineRef.current = null;
    };
  }, { dependencies: [phase, from] });

  if (phase !== 'flying') return null;
  return (
    <div
      ref={outerRef}
      className="pointer-events-none fixed left-0 top-0 z-[210]"
      data-testid="ember-hatch-overlay"
      aria-hidden="true"
    >
      <div ref={innerRef} className="ember-seal h-[15px] w-[15px] rounded-full" />
    </div>
  );
}
