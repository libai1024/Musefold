import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';

type DropdownMenuContentProps = React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.Content
> & {
  onOpenAutoFocus?: (event: Event) => void;
};

const DropdownMenuContentPrimitive =
  DropdownMenuPrimitive.Content as unknown as React.ForwardRefExoticComponent<
    DropdownMenuContentProps & React.RefAttributes<HTMLDivElement>
  >;

function handleHomeEnd(
  event: React.KeyboardEvent<HTMLDivElement>,
  onKeyDownCapture: DropdownMenuContentProps['onKeyDownCapture'],
) {
  onKeyDownCapture?.(event);
  if (event.defaultPrevented || (event.key !== 'Home' && event.key !== 'End')) return;
  const items = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([data-disabled])'),
  );
  const target = event.key === 'Home' ? items[0] : items.at(-1);
  if (!target) return;
  event.preventDefault();
  event.stopPropagation();
  target.focus();
}

export const DropdownMenuContent = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Content>,
  DropdownMenuContentProps
>(function DropdownMenuContent(
  { className, sideOffset = 4, onKeyDownCapture, onOpenAutoFocus, ...props },
  ref,
) {
  const content = (
    <DropdownMenuContentPrimitive
      ref={ref}
      sideOffset={sideOffset}
      className={['mf-ui-dropdown-content', className].filter(Boolean).join(' ')}
      onKeyDownCapture={(event) => handleHomeEnd(event, onKeyDownCapture)}
      onOpenAutoFocus={(event) => {
        onOpenAutoFocus?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        const currentTarget = event.currentTarget as HTMLElement | null;
        const firstItem = currentTarget?.querySelector<HTMLElement>(
          '[role="menuitem"]:not([data-disabled])',
        );
        firstItem?.focus();
      }}
      {...props}
    />
  );
  // Node static rendering has no document, so keep content in the test tree.
  if (typeof document === 'undefined') return content;
  return <DropdownMenuPrimitive.Portal>{content}</DropdownMenuPrimitive.Portal>;
});
