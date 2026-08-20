import type { HTMLAttributes } from 'react';
import musefoldLogo from '../../../../../docs/v0.3/logo.png';
import { cn } from '../../lib/utils';

export function MusefoldLogo({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('relative aspect-[2.7/1] overflow-hidden', className)}
      {...props}
    >
      <img
        src={musefoldLogo}
        alt="Musefold / 未像"
        className="musefold-brand-image absolute left-1/2 top-1/2 block h-auto w-[120%] max-w-none -translate-x-1/2 -translate-y-1/2"
      />
    </div>
  );
}
