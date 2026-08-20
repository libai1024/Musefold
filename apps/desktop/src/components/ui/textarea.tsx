// src/components/ui/textarea.tsx
import * as React from 'react';
import { cn } from '../../lib/utils';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  mono?: boolean;
};

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, mono, ...props }, ref) => (
    <textarea
      className={cn(
        'no-drag flex w-full resize-y rounded-md border border-border-default bg-elevated px-2.5 py-1.5 text-xs text-primary caret-accent placeholder:text-tertiary shadow-[var(--highlight-inset)] transition-[border-color,box-shadow,background-color] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:border-border-strong focus-visible:border-border-strong focus-visible:bg-popover focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger/70 aria-invalid:ring-danger/20',
        mono && 'font-mono tracking-tight leading-relaxed',
        className
      )}
      ref={ref}
      {...props}
    />
  )
);
Textarea.displayName = 'Textarea';
