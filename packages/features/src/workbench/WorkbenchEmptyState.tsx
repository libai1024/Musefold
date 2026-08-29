'use client';

import { MusefoldMark } from '@musefold/ui/components/brand-mark';
import { type CSSProperties, type ReactNode, useEffect, useState } from 'react';

/** 水印词:逐字母拆分以支持错相呼吸与逐字母 hover 高亮(动效规则在 ui globals.css)。 */
const WATERMARK_WORD = 'Musefold';

/**
 * 时段问候语(承 ZCode 主界面语法,01 §3):空态首行随本地时间变化,
 * 品牌 tagline 降为副标。E2E 视觉基线用 page.clock 固定时间保证确定性。
 */
export function emptyStateGreeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return '早上好，从一个想法开始';
  if (hour >= 12 && hour < 14) return '中午好，随手画点什么';
  if (hour >= 14 && hour < 18) return '下午好，继续你的创作';
  return '晚上好，灵感正好';
}

/** 每行轨道内单份序列的重复次数;轨道渲染两份序列,配合 translateX(-50%) 无缝循环。 */
const SEQUENCE_COPIES = 4;

/** 空态快捷建议(承旧建议池前三条):只回填草稿,不自动生成。 */
export const EMPTY_STATE_SUGGESTIONS = [
  '漂浮在云层上的小型图书馆，克制电影感，阴天漫射光，细腻阴影',
  '雨夜东京街角，柔和日系生活方式，低饱和自然光，对角线构图',
  '透明背景护肤品主视觉，柔和反射，高端广告质感',
] as const;

export interface WorkbenchEmptyStateProps {
  /** 空态内联 Composer(品牌锁定区与 Composer 共用中心轴)。 */
  composer: ReactNode;
  onSelectSuggestion(suggestion: string): void;
}

/**
 * 工作台品牌空态(ui-parity 03 §5 恢复,承旧 v2.5-baseline WorkbenchEmptyState):
 * 水印背景(逐字母呼吸)+ 品牌锁定区(mark 96px + tagline)+ 三条横滚建议 + 内联 Composer。
 * 不是营销 Hero:无插画、无渐变文字、无独立 CTA;建议只回填草稿,不自动生成。
 * 呼吸/横滚为长周期环境动画,减少动效双通道下降级为静态(ui globals.css)。
 */
export function WorkbenchEmptyState({ composer, onSelectSuggestion }: WorkbenchEmptyStateProps) {
  // Web 壳预渲染的构建时刻 ≠ 用户本地时刻,挂载后再计算,避免水合文案错位。
  const [greeting, setGreeting] = useState<string | null>(null);
  useEffect(() => {
    setGreeting(emptyStateGreeting());
  }, []);

  return (
    <div
      className="relative mx-auto flex w-full min-w-0 max-w-3xl flex-1 flex-col overflow-y-auto px-4 pt-[clamp(48px,12vh,96px)] pb-12 md:pt-[clamp(72px,16vh,140px)] [@media(max-height:560px)]:pt-5 [@media(max-height:560px)]:pb-4"
      data-testid="workbench-empty"
    >
      <div
        className="mf-workbench-empty-watermark"
        aria-hidden="true"
        data-testid="workbench-empty-watermark"
      >
        <div className="mf-workbench-empty-watermark-word">
          {[...WATERMARK_WORD].map((letter, index) => (
            <span key={`${letter}-${index}`} style={{ '--i': index } as CSSProperties}>
              {letter}
            </span>
          ))}
        </div>
      </div>

      {/* 收缩到内容宽,不整行盖水印:mark 两侧的水印字母才能响应 hover。 */}
      <div
        className="mf-workbench-empty-brand relative z-1 flex flex-col items-center gap-2.5 self-center text-center"
        data-testid="workbench-empty-brand"
      >
        <MusefoldMark
          className="size-[72px] text-foreground drop-shadow-sm md:size-24 [@media(max-height:560px)]:size-14"
          aria-hidden="true"
          focusable="false"
        />
        <h1
          className="min-h-7 font-semibold text-foreground text-xl tracking-tight md:min-h-8 md:text-2xl [@media(max-height:560px)]:hidden"
          data-testid="workbench-empty-greeting"
        >
          {greeting ?? '\u00A0'}
        </h1>
        <p className="text-[13px] text-muted-foreground" data-testid="workbench-empty-slogan">
          把想法变成可生成的视觉
        </p>
      </div>

      {/* 矮视口(软键盘/小窗)建议行让位,Composer 与发送钮保持可见(承旧 11 §10.3)。 */}
      <div
        className="relative z-1 mx-auto mt-5 flex w-full max-w-lg flex-col items-stretch gap-0.5 [@media(max-height:560px)]:hidden"
        aria-label="快捷建议"
        data-testid="generation-directions"
      >
        {EMPTY_STATE_SUGGESTIONS.map((suggestion) => {
          const sequence = Array.from({ length: SEQUENCE_COPIES }, () => suggestion);
          return (
            <div className="mf-workbench-direction-row" key={suggestion}>
              <button
                type="button"
                className="absolute inset-0 z-2 w-full cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2"
                onClick={() => onSelectSuggestion(suggestion)}
                data-testid="generation-example"
              >
                <span className="sr-only">{suggestion}</span>
              </button>
              <div className="mf-workbench-direction-track" aria-hidden="true">
                {sequence.concat(sequence).map((text, copyIndex) => (
                  <span
                    className="mf-workbench-direction-item"
                    key={`${copyIndex}-${text.slice(0, 8)}`}
                  >
                    {text}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="relative z-1 mt-6 w-full [@media(max-height:560px)]:mt-4">{composer}</div>
    </div>
  );
}
