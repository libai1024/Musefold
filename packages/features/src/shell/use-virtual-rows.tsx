'use client';

import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual';
import { type ReactNode, type RefObject, useEffect, useRef, useSyncExternalStore } from 'react';

/** 超过此条数才挂虚拟列表,避免小列表也吃测量开销(ui-parity 04/05 §6)。 */
export const VIRTUAL_LIST_THRESHOLD = 150;
export const VIRTUAL_OVERSCAN = 5;

/** 提示词行估算:舒适 76 / 宽松 72 + 4px 缝(旧 LibraryPage)。 */
export function promptRowEstimate(density: 'comfortable' | 'compact'): number {
  return (density === 'compact' ? 72 : 76) + 4;
}

/** 历史单行估算(旧 HistoryList 86/88)。线程组 = 行数 × 本值。 */
export function historyRowEstimate(density: 'comfortable' | 'compact'): number {
  return density === 'compact' ? 86 : 88;
}

export function historyThreadEstimate(
  memberCount: number,
  density: 'comfortable' | 'compact',
): number {
  return Math.max(1, memberCount) * historyRowEstimate(density);
}

export function shouldVirtualizeList(count: number): boolean {
  return count > VIRTUAL_LIST_THRESHOLD;
}

/** jsdom 的 getBoundingClientRect 恒为 0,量了会让总高度塌成 0、整表进视口。 */
export function canMeasureVirtualRows(): boolean {
  return typeof navigator !== 'undefined' && !/jsdom/i.test(navigator.userAgent);
}

function subscribeDensity(notify: () => void): () => void {
  if (typeof MutationObserver !== 'function' || typeof document === 'undefined') {
    return () => {};
  }
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-density'],
  });
  return () => observer.disconnect();
}

function readDensity(): 'comfortable' | 'compact' {
  return document.documentElement.dataset.density === 'compact' ? 'compact' : 'comfortable';
}

/** 读 `<html data-density>`,不走 preferences 查询,列表屏零 gateway 耦合。 */
export function useDocumentDensity(): 'comfortable' | 'compact' {
  return useSyncExternalStore(subscribeDensity, readDensity, () => 'comfortable');
}

/** 密度切换后重测行高(旧 virtualizer.measure() 教训)。 */
export function useRemeasureOnDensity(virtualizer: { measure(): void }): void {
  const density = useDocumentDensity();
  const previous = useRef(density);
  useEffect(() => {
    if (previous.current === density) return;
    previous.current = density;
    virtualizer.measure();
  }, [density, virtualizer]);
}

const JSDOM_VIEWPORT = { width: 960, height: 720 } as const;
const JSDOM_SCROLL_EXTENT = 1_000_000;
const jsdomDecoratedScrollers = new WeakSet<HTMLElement>();

/** jsdom 不布局:给滚动容器补视口/可滚高度,否则 tanstack 把 scrollToIndex 夹成 0。 */
function decorateJsdomScroller(element: HTMLElement | null): HTMLElement | null {
  if (!element || jsdomDecoratedScrollers.has(element)) return element;
  jsdomDecoratedScrollers.add(element);
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    value: JSDOM_VIEWPORT.height,
  });
  Object.defineProperty(element, 'clientWidth', {
    configurable: true,
    value: JSDOM_VIEWPORT.width,
  });
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    value: JSDOM_SCROLL_EXTENT,
  });
  Object.defineProperty(element, 'scrollWidth', {
    configurable: true,
    value: JSDOM_VIEWPORT.width,
  });
  return element;
}

export function useListVirtualizer(options: {
  count: number;
  getScrollElement: () => HTMLElement | null;
  estimateSize: (index: number) => number;
  scrollMargin?: number;
  /**
   * AppShell `<md` 是页面滚动(无 `h-dvh overflow-hidden`)。
   * 内层 overflow 容器会被内容撑开,必须改读 window 视口,否则整表进 range。
   * jsdom 单测仍走 element + 装饰器,不启用本档。
   */
  useWindowScroll?: boolean;
}): Virtualizer<HTMLElement, Element> {
  const estimateSize = options.estimateSize;
  const canMeasure = canMeasureVirtualRows();
  const useWindow = Boolean(options.useWindowScroll) && canMeasure;
  // jsdom 的 offsetHeight / scrollTo 恒为 0:默认 observe 会覆盖 initialRect,
  // scrollToIndex 也被夹死。单测用固定视口 + 内存偏移,生产走真实测量。
  const jsdomOffsetRef = useRef(0);
  const jsdomOffsetListener = useRef<((offset: number, isScrolling: boolean) => void) | null>(null);
  const virtualizer = useVirtualizer({
    count: options.count,
    getScrollElement: () => {
      if (useWindow) return document.documentElement;
      return canMeasure
        ? options.getScrollElement()
        : decorateJsdomScroller(options.getScrollElement());
    },
    estimateSize,
    overscan: VIRTUAL_OVERSCAN,
    scrollMargin: options.scrollMargin ?? 0,
    measureElement: (element) => {
      const index = Number(element.getAttribute('data-index') ?? 0);
      if (!canMeasure) return estimateSize(index);
      const height = element.getBoundingClientRect().height;
      return height > 0 ? height : estimateSize(index);
    },
    ...(useWindow
      ? {
          observeElementRect: (
            _instance: Virtualizer<HTMLElement, Element>,
            cb: (rect: { width: number; height: number }) => void,
          ) => {
            const notify = () => cb({ width: window.innerWidth, height: window.innerHeight });
            notify();
            window.addEventListener('resize', notify);
            return () => window.removeEventListener('resize', notify);
          },
          observeElementOffset: (
            _instance: Virtualizer<HTMLElement, Element>,
            cb: (offset: number, isScrolling: boolean) => void,
          ) => {
            const notify = () => cb(window.scrollY, true);
            window.addEventListener('scroll', notify, { passive: true });
            cb(window.scrollY, false);
            return () => window.removeEventListener('scroll', notify);
          },
          scrollToFn: (offset: number, scrollOptions: { adjustments?: number }) => {
            window.scrollTo({ top: offset + (scrollOptions.adjustments ?? 0) });
          },
        }
      : canMeasure
        ? {}
        : {
            initialRect: JSDOM_VIEWPORT,
            observeElementRect: (
              _instance: Virtualizer<HTMLElement, Element>,
              cb: (rect: { width: number; height: number }) => void,
            ) => {
              cb(JSDOM_VIEWPORT);
            },
            observeElementOffset: (
              _instance: Virtualizer<HTMLElement, Element>,
              cb: (offset: number, isScrolling: boolean) => void,
            ) => {
              jsdomOffsetListener.current = cb;
              cb(jsdomOffsetRef.current, false);
              return () => {
                if (jsdomOffsetListener.current === cb) jsdomOffsetListener.current = null;
              };
            },
            scrollToFn: (
              offset: number,
              scrollOptions: { adjustments?: number },
              instance: Virtualizer<HTMLElement, Element>,
            ) => {
              jsdomOffsetRef.current = offset + (scrollOptions.adjustments ?? 0);
              const element = instance.scrollElement;
              if (element) element.scrollTop = jsdomOffsetRef.current;
              jsdomOffsetListener.current?.(jsdomOffsetRef.current, false);
            },
          }),
  });
  useRemeasureOnDensity(virtualizer);
  return virtualizer;
}

export function VirtualListFrame({
  virtualizer,
  listRef,
  testId = 'virtual-list',
  children,
}: {
  virtualizer: Virtualizer<HTMLElement, Element>;
  listRef?: RefObject<HTMLDivElement | null>;
  testId?: string;
  children: (index: number) => ReactNode;
}) {
  return (
    <div
      ref={listRef}
      className="relative w-full"
      data-testid={testId}
      style={{ height: `${virtualizer.getTotalSize()}px` }}
    >
      {virtualizer.getVirtualItems().map((virtualRow) => (
        <div
          key={virtualRow.key}
          data-index={virtualRow.index}
          ref={canMeasureVirtualRows() ? virtualizer.measureElement : undefined}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            transform: `translateY(${virtualRow.start - virtualizer.options.scrollMargin}px)`,
          }}
        >
          {children(virtualRow.index)}
        </div>
      ))}
    </div>
  );
}
