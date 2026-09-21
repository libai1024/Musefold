'use client';

import { useState } from 'react';
import { FadeImage } from '@musefold/ui/components/fade-image';
import { Button } from '@musefold/ui/components/button';
import { Skeleton } from '@musefold/ui/components/skeleton';
import { ImageOff } from '@musefold/ui/icons';
import { cn } from '@musefold/ui/lib/utils';

type Props = {
  src: string;
  alt: string;
  className?: string;
  compact?: boolean;
  onOpen?: (trigger: HTMLButtonElement) => void;
};

/** Scheme-specific feedback; changing asset URLs discards the previous load/error state. */
export function SchemeAssetImage(props: Props) {
  return <SchemeImageAttempt key={props.src} {...props} />;
}

function SchemeImageAttempt({ src, alt, className, compact = false, onOpen }: Props) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  if (failed) {
    return (
      <span className="flex h-full w-full flex-col items-center justify-center gap-2 bg-card p-2 text-center text-muted-foreground">
        <ImageOff className="size-5 shrink-0" aria-hidden />
        <span className={compact ? 'sr-only' : 'text-sm'} role="status">
          图片暂时无法显示
        </span>
        {!compact ? (
          <>
            <span className="text-xs">请检查网络或登录状态后重试。</span>
            <Button
              variant="outline"
              className="min-h-11 md:min-h-8"
              onClick={() => {
                setAttempt((value) => value + 1);
                setFailed(false);
              }}
            >
              重新加载图片
            </Button>
          </>
        ) : null}
      </span>
    );
  }
  const image = (
    <span className="relative flex h-full w-full items-center justify-center overflow-hidden">
      <FadeImage
        key={attempt}
        src={src}
        alt={alt}
        loading={compact ? 'lazy' : undefined}
        onError={() => setFailed(true)}
        className={cn('peer h-full w-full object-contain', className)}
      />
      <Skeleton className="pointer-events-none absolute inset-0 peer-data-[loaded=true]:hidden" />
      <span
        className="sr-only peer-data-[loaded=true]:hidden"
        role={compact ? undefined : 'status'}
      >
        图片加载中
      </span>
    </span>
  );
  return onOpen ? (
    <button
      type="button"
      onClick={(event) => onOpen(event.currentTarget)}
      aria-label="全屏查看当前示例"
      className="h-full w-full cursor-zoom-in rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      {image}
    </button>
  ) : (
    image
  );
}
