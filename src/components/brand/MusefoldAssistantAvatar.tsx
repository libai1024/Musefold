import type { HTMLAttributes } from 'react';
import musefoldAssistantLogo from './musefold-assistant-avatar.png';
import { cn } from '../../lib/utils';

export function MusefoldAssistantAvatar({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="img"
      aria-label="Musefold AI"
      className={cn(
        'relative h-14 w-14 shrink-0 overflow-hidden rounded-full bg-elevated',
        className,
      )}
      {...props}
    >
      <img
        src={musefoldAssistantLogo}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="absolute inset-0 block h-full w-full object-cover"
      />
    </div>
  );
}
