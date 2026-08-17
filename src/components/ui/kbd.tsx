// src/components/ui/kbd.tsx
// 键位提示 —— 紧凑发丝框，mono
import * as React from 'react';
import { cn } from '../../lib/utils';

export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-sm border border-border-subtle bg-inset px-1 font-mono text-[10px] font-medium leading-none text-tertiary',
        className
      )}
      {...props}
    />
  );
}
