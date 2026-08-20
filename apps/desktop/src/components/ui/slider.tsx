// src/components/ui/slider.tsx
// Codex 风滑块 —— 紧凑轨道 + Ember 范围 + 弹簧 thumb

import * as React from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { cn } from '../../lib/utils';

export const Slider = React.forwardRef<
  React.ComponentRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn('no-drag relative flex w-full touch-none select-none items-center', className)}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-border-default">
      <SliderPrimitive.Range className="absolute h-full bg-accent" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="block h-3.5 w-3.5 rounded-full border border-accent bg-popover shadow-sm transition-transform duration-[var(--dur-fast)] ease-[var(--ease-spring)] hover:scale-110 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:opacity-50" />
  </SliderPrimitive.Root>
));
Slider.displayName = 'Slider';
