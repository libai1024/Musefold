import { useRef, type HTMLAttributes } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { useAppStore } from '../../stores/app';
import { cn } from '../../lib/utils';

gsap.registerPlugin(useGSAP);

interface MusefoldLogoAnimatedProps extends HTMLAttributes<HTMLDivElement> {
  /** calm：更缓慢、更有仪式感的入场节奏（引导页 hero 等大尺寸场景用） */
  tempo?: 'default' | 'calm';
  /** 入场完成后保持轻微待机动态：Ember 点呼吸 + 整体轻浮动 */
  idle?: boolean;
}

/**
 * Musefold「Unfolded Frame」品牌标记的矢量动画版。
 * 几何数据从受版本控制的 Musefold 图标主稿量测而来，
 * 分层为：厚石墨 L 形背板、细边前板、翻折页角、Ember 圆点，供 GSAP 分层入场。
 */
export function MusefoldLogoAnimated({
  className,
  tempo = 'default',
  idle = false,
  ...props
}: MusefoldLogoAnimatedProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);
  const reducedMotion = useAppStore((s) => s.reducedMotion);

  useGSAP((_context, contextSafe) => {
    const media = gsap.matchMedia();
    // calm 只放慢入场编排；待机呼吸的时长独立指定，不随入场变速。
    const slow = tempo === 'calm' ? 2.1 : 1;
    const startMotion = () => {
      const timeline = gsap.timeline({ defaults: { ease: 'power3.out' } });
      timeline
        .from('[data-logo-frame]', { autoAlpha: 0, x: -5, y: -5, duration: 0.42 * slow })
        .from('[data-logo-edges]', { autoAlpha: 0, x: 4, y: 4, duration: 0.42 * slow }, `-=${0.26 * slow}`)
        .from('[data-logo-fold]', {
          autoAlpha: 0,
          scale: 0.25,
          rotation: -24,
          transformOrigin: '100% 0%',
          duration: 0.5 * slow,
          ease: 'back.out(1.5)',
        }, `-=${0.2 * slow}`)
        .from('[data-logo-dot]', {
          autoAlpha: 0,
          scale: 0,
          transformOrigin: '50% 50%',
          duration: 0.34 * slow,
          ease: 'back.out(2.4)',
        }, `-=${0.18 * slow}`);
      if (idle) {
        // 无限循环使 isActive() 恒为 true，悬停重播随之自然停用。
        timeline
          .to('[data-logo-dot]', {
            scale: 1.07,
            transformOrigin: '50% 50%',
            duration: 1.4,
            ease: 'sine.inOut',
            yoyo: true,
            repeat: -1,
          }, '+=0.6')
          .to('[data-logo-svg]', {
            y: -2.5,
            duration: 2.6,
            ease: 'sine.inOut',
            yoyo: true,
            repeat: -1,
          }, '<');
      }
      timelineRef.current = timeline;
      return () => {
        // revert 而不是 kill：中途切换“减少动态”时恢复到完整可见的最终状态
        timeline.revert();
        timelineRef.current = null;
      };
    };

    const replay = contextSafe?.(() => {
      const timeline = timelineRef.current;
      if (timeline && !timeline.isActive()) timeline.restart();
    });
    const root = rootRef.current;
    if (replay) root?.addEventListener('pointerenter', replay);

    let cleanupMotion: (() => void) | undefined;
    if (reducedMotion === 'off') cleanupMotion = startMotion();
    else if (reducedMotion !== 'on') media.add('(prefers-reduced-motion: no-preference)', startMotion);

    return () => {
      if (replay) root?.removeEventListener('pointerenter', replay);
      cleanupMotion?.();
      media.revert();
    };
  }, { scope: rootRef, dependencies: [reducedMotion, tempo, idle] });

  return (
    <div
      ref={rootRef}
      role="img"
      aria-label="Musefold / 未像"
      className={cn('text-primary', className)}
      {...props}
    >
      <svg data-logo-svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="block h-full w-full">
        {/* 背板：厚石墨 L（左侧 + 顶部） */}
        <path
          data-logo-frame
          fill="currentColor"
          d="M 6 0 H 94 A 6 6 0 0 1 100 6 V 12.4 H 21 Q 17 12.4 17 16.4 V 100 H 6 A 6 6 0 0 1 0 94 V 6 A 6 6 0 0 1 6 0 Z"
        />
        {/* 前板：纸张右侧与底部的细边 */}
        <g data-logo-edges fill="currentColor">
          <rect x="98.6" y="4" width="1.4" height="51.2" />
          <rect x="15" y="98.6" width="38" height="1.4" />
        </g>
        {/* 页角翻折：外缘为 45° 直线切角；折痕为「平顶 → 膝弯 → 近直线斜降」。 */}
        <path
          data-logo-fold
          fill="currentColor"
          d="M 100 54 L 53.2 100 L 50.6 100 L 50.6 98.6 L 52.0 98.1 C 52.41 97.49 53.39 96.41 54.46 94.46 C 55.53 92.51 56.93 89.43 58.42 86.42 C 59.91 83.41 61.71 79.71 63.4 76.4 C 65.09 73.09 67.16 69.16 68.56 66.56 C 69.96 63.96 70.74 62.24 71.8 60.8 C 72.86 59.36 73.75 58.75 74.92 57.92 C 76.09 57.09 77.34 56.34 78.82 55.82 C 80.3 55.3 81.47 54.97 83.8 54.8 C 86.13 54.63 90.51 54.95 92.8 54.8 C 95.09 54.65 96.75 54.05 97.54 53.9 L 98.6 53.8 Z"
        />
        {/* 灵感种子点：唯一的 Ember 时刻 */}
        <circle data-logo-dot cx="84.2" cy="27.2" r="6.8" fill="var(--accent)" />
      </svg>
    </div>
  );
}
