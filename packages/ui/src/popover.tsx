import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { Slot } from '@radix-ui/react-slot';

interface PopoverContextValue {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef: React.MutableRefObject<HTMLButtonElement | null>;
}

const PopoverContext = React.createContext<PopoverContextValue | null>(null);

function usePopoverContext(component: string) {
  const context = React.useContext(PopoverContext);
  if (!context) {
    throw new Error(`${component} must be used inside Popover`);
  }
  return context;
}

function composeRefs<T>(
  ...refs: Array<React.ForwardedRef<T> | React.MutableRefObject<T | null> | undefined>
) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === 'function') ref(node);
      else ref.current = node;
    }
  };
}

export interface UiPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export function Popover({ open, onOpenChange, children }: UiPopoverProps) {
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const context = React.useMemo(() => ({ open, onOpenChange, triggerRef }), [onOpenChange, open]);
  return <PopoverContext.Provider value={context}>{children}</PopoverContext.Provider>;
}

export interface UiPopoverTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
}

export const PopoverTrigger = React.forwardRef<HTMLButtonElement, UiPopoverTriggerProps>(
  function PopoverTrigger({ asChild = false, onClick, children, ...props }, ref) {
    const context = usePopoverContext('PopoverTrigger');
    const triggerProps = {
      ...props,
      ref: composeRefs(context.triggerRef, ref),
      'aria-expanded': context.open,
      onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (!event.defaultPrevented) context.onOpenChange(!context.open);
      },
    };
    if (asChild) return <Slot {...triggerProps}>{children}</Slot>;
    return (
      <button type="button" {...triggerProps}>
        {children}
      </button>
    );
  },
);

export interface UiPopoverContentProps extends React.HTMLAttributes<HTMLDivElement> {
  portal?: boolean;
}

export const PopoverContent = React.forwardRef<HTMLDivElement, UiPopoverContentProps>(
  function PopoverContent({ className, portal = true, children, ...props }, ref) {
    const context = usePopoverContext('PopoverContent');
    const contentRef = React.useRef<HTMLDivElement | null>(null);
    const setContentRef = composeRefs(contentRef, ref);

    React.useEffect(() => {
      if (!context.open) return;
      const onPointerDown = (event: PointerEvent) => {
        const target = event.target as Node;
        if (contentRef.current?.contains(target) || context.triggerRef.current?.contains(target)) {
          return;
        }
        context.onOpenChange(false);
      };
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.defaultPrevented || event.key !== 'Escape') return;
        event.preventDefault();
        context.onOpenChange(false);
        context.triggerRef.current?.focus();
      };
      document.addEventListener('pointerdown', onPointerDown);
      document.addEventListener('keydown', onKeyDown);
      return () => {
        document.removeEventListener('pointerdown', onPointerDown);
        document.removeEventListener('keydown', onKeyDown);
      };
    }, [context]);

    React.useEffect(() => {
      if (!context.open) return;
      return () => {
        context.triggerRef.current?.focus();
      };
    }, [context.open, context.triggerRef]);

    if (!context.open) return null;
    const content = (
      <div
        ref={setContentRef}
        className={['mf-ui-popover-content', className].filter(Boolean).join(' ')}
        data-state="open"
        {...props}
      >
        {children}
      </div>
    );
    if (!portal || typeof document === 'undefined') return content;
    return ReactDOM.createPortal(content, document.body);
  },
);
