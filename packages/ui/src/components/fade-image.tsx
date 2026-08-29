'use client';

import { useCallback, useState } from 'react';

import { cn } from '@musefold/ui/lib/utils';

/**
 * 图像载入淡入原语(00-codex-craft §5.6,C-5):
 * 占位底色由容器提供(`bg-muted`),图像载入完成后 opacity 0→1(`--dur-fast`),防白闪。
 * 装饰性过渡,不带 data-motion-exempt —— 减少动效分级下被压制为瞬时到达,行为正确。
 */
function FadeImage({ className, onLoad, ...props }: Omit<React.ComponentProps<'img'>, 'ref'>) {
  const [loaded, setLoaded] = useState(false);
  // 缓存命中的图片可能在 React 挂载 onLoad 前就已完成解码,此时 load 事件不再触发,
  // 靠 ref 回调里的 complete 兜底,否则图片会停在 opacity-0。
  const probeComplete = useCallback((node: HTMLImageElement | null) => {
    if (node?.complete && node.naturalWidth > 0) setLoaded(true);
  }, []);

  return (
    <img
      ref={probeComplete}
      data-slot="fade-image"
      data-loaded={loaded}
      onLoad={(event) => {
        setLoaded(true);
        onLoad?.(event);
      }}
      className={cn(
        'opacity-0 transition-opacity duration-(--dur-fast) ease-out data-[loaded=true]:opacity-100',
        className,
      )}
      {...props}
    />
  );
}

export { FadeImage };
