// src/components/ui/input.tsx
// Codex 风输入框 —— 紧凑、中性焦点、避免输入时出现强调色矩形
// 详见 docs/06-ui-design-system.md §5.1

import * as React from 'react';
import { cn } from '../../lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  mono?: boolean;
};

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, mono, ...props }, ref) => {
    return (
      <input
        className={cn(
          'no-drag flex h-8 w-full rounded-md border border-border-default bg-elevated px-2.5 text-xs text-primary caret-accent shadow-[inset_0_1px_1px_rgba(0,0,0,0.035)] placeholder:text-tertiary transition-[border-color,box-shadow,background-color] duration-[var(--dur-fast)] ease-out hover:border-border-strong focus-visible:border-border-strong focus-visible:bg-popover focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger/70 aria-invalid:ring-danger/20',
          mono && 'font-mono tracking-tight',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';
