import { ArrowLeft, PanelRightClose } from '@musefold/ui/icons';
import { Button } from '@musefold/ui';
import { useEffect, useRef, type ReactNode } from 'react';

export interface PromptLibraryWorkspaceProps {
  list: ReactNode;
  detail?: ReactNode;
  detailOpen: boolean;
  onClose: () => void;
  listRef?: (node: HTMLDivElement | null) => void;
  detailLabel?: string;
  backLabel?: string;
  className?: string;
  testId?: string;
}

/** Shared Prompt Library list/inspector geometry with a compact single-page detail state. */
export function PromptLibraryWorkspace({
  list,
  detail,
  detailOpen,
  onClose,
  listRef,
  detailLabel = '提示词详情',
  backLabel = '提示词库',
  className,
  testId = 'prompt-library-workspace',
}: PromptLibraryWorkspaceProps) {
  const internalListRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const returnFocusKeyRef = useRef<{ promptId: string; testId: string | null } | null>(null);
  const wasDetailOpenRef = useRef(false);

  useEffect(() => {
    const wasDetailOpen = wasDetailOpenRef.current;
    let focusFrame: number | undefined;
    let settleFrame: number | undefined;

    if (!wasDetailOpen && detailOpen) {
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLElement &&
        internalListRef.current?.contains(activeElement)
      ) {
        returnFocusRef.current = activeElement;
      }
    }

    if (wasDetailOpen && !detailOpen) {
      focusFrame = window.requestAnimationFrame(() => {
        settleFrame = window.requestAnimationFrame(() => {
          const target = returnFocusRef.current;
          if (target?.isConnected) {
            target.focus({ preventScroll: true });
            return;
          }

          const key = returnFocusKeyRef.current;
          const list = internalListRef.current;
          const row = key
            ? Array.from(list?.querySelectorAll('[data-prompt-id]') ?? []).find(
                (candidate) =>
                  candidate instanceof HTMLElement && candidate.dataset.promptId === key.promptId,
              )
            : null;
          const replacement =
            row instanceof HTMLElement && key
              ? row.querySelector<HTMLElement>(
                  key.testId ? `[data-testid="${key.testId}"]` : 'button:not(:disabled)',
                )
              : null;
          if (replacement) replacement.focus({ preventScroll: true });
          else internalListRef.current?.focus({ preventScroll: true });
        });
      });
    }

    wasDetailOpenRef.current = detailOpen;
    return () => {
      if (focusFrame !== undefined) window.cancelAnimationFrame(focusFrame);
      if (settleFrame !== undefined) window.cancelAnimationFrame(settleFrame);
    };
  }, [detailOpen]);

  const setListRef = (node: HTMLDivElement | null) => {
    internalListRef.current = node;
    listRef?.(node);
  };

  return (
    <div
      className={`mf-prompt-library-workspace${className ? ` ${className}` : ''}`}
      data-detail-open={detailOpen ? 'true' : 'false'}
      data-testid={testId}
    >
      <div
        ref={setListRef}
        className="mf-prompt-library-workspace-list"
        role="region"
        aria-label="提示词列表"
        data-testid="prompt-list"
        tabIndex={-1}
        onFocusCapture={(event) => {
          const target = event.target;
          if (target instanceof HTMLElement && target !== internalListRef.current) {
            returnFocusRef.current = target;
            const row = target.closest<HTMLElement>('[data-prompt-id]');
            if (row?.dataset.promptId) {
              returnFocusKeyRef.current = {
                promptId: row.dataset.promptId,
                testId: target.dataset.testid ?? null,
              };
            }
          }
        }}
      >
        {list}
      </div>
      <aside
        className="mf-prompt-library-workspace-inspector"
        aria-label={detailLabel}
        aria-hidden={!detailOpen}
        data-testid="prompt-inspector"
      >
        {detailOpen ? (
          <div className="mf-prompt-library-inspector-surface">
            <div className="mf-prompt-library-inspector-bar">
              <strong>{detailLabel}</strong>
              <Button
                variant="ghost"
                className="mf-prompt-library-detail-close"
                aria-label={`关闭${detailLabel}`}
                onClick={onClose}
                data-testid="detail-back"
              >
                <ArrowLeft className="mf-prompt-library-back-icon" aria-hidden="true" />
                <PanelRightClose className="mf-prompt-library-close-icon" aria-hidden="true" />
                <span>{backLabel}</span>
              </Button>
            </div>
            <div className="mf-prompt-library-workspace-detail">{detail}</div>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
