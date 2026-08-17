// src/components/ui/button.tsx
// shadcn/ui copy-paste 模式示例 —— 基于 Radix Slot + class-variance-authority
// 详见 docs/06-ui-design-system.md §5.1

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'no-drag relative inline-flex select-none items-center justify-center rounded-md font-medium whitespace-nowrap transition-[background-color,border-color,color,transform,box-shadow] duration-[var(--dur-fast)] ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-elevated disabled:pointer-events-none disabled:opacity-45 active:translate-y-px active:scale-[0.98]',
  {
    variants: {
      variant: {
        default:
          'bg-accent text-on-accent hover:bg-accent-hover active:bg-accent-press',
        // Codex 黑：设置域主按钮（浅色黑底白字，深色白底黑字）
        primary: 'bg-primary text-background hover:opacity-85 active:opacity-75',
        subtle: 'border border-transparent bg-accent-soft text-accent hover:border-accent/20 hover:bg-[color-mix(in_oklab,var(--accent)_20%,transparent)]',
        ghost: 'text-secondary hover:bg-hover hover:text-primary active:bg-pressed',
        outline:
          'border border-border-default bg-elevated text-primary hover:border-border-strong hover:bg-hover',
        danger:
          'bg-danger text-on-danger hover:brightness-105',
      },
      size: {
        xs: 'h-6 px-2 text-[11px] gap-1',
        sm: 'h-7 px-2.5 text-xs gap-1.5',
        md: 'h-8 px-3 text-xs gap-1.5',
        lg: 'h-9 px-4 text-sm gap-2',
        icon: 'h-8 w-8',
        iconSm: 'h-7 w-7',
        iconXs: 'h-6 w-6',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { buttonVariants };
