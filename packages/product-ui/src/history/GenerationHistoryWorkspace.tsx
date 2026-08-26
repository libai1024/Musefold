import { ArrowLeft, PanelRightClose } from '@musefold/ui/icons';
import { Button, Drawer, DrawerContent, DrawerTitle, IconButton } from '@musefold/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PRODUCT_MOBILE_BREAKPOINT } from '../navigation/ProductSidebarLayout';

export interface GenerationHistoryWorkspaceProps {
  list: ReactNode;
  detail?: ReactNode;
  detailOpen: boolean;
  onBack?: () => void;
  backLabel?: string;
  className?: string;
  testId?: string;
}

/** Shared list/inspector layout; phone details move into the modal bottom sheet. */
export function GenerationHistoryWorkspace({
  list,
  detail,
  detailOpen,
  onBack,
  backLabel = '生成历史',
  className,
  testId = 'history-workspace',
}: GenerationHistoryWorkspaceProps) {
  const phone = usePhoneHistoryLayout();
  const listRef = useRef<HTMLElement>(null);
  const returnFocusTargetRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.inert = phone && detailOpen;
    return () => {
      list.inert = false;
    };
  }, [detailOpen, phone]);

  const detailSurface = detailOpen ? (
    <div className="mf-history-inspector-surface">
      <div className="mf-history-inspector-bar">
        <strong>生成详情</strong>
        {onBack ? (
          <IconButton
            className="mf-icon-button"
            label="关闭生成详情"
            onClick={onBack}
            data-testid="history-detail-close"
          >
            <PanelRightClose aria-hidden="true" />
          </IconButton>
        ) : null}
      </div>
      <div className="mf-history-workspace-detail">
        {onBack ? (
          <Button
            variant="ghost"
            className="mf-history-workspace-back"
            onClick={onBack}
            data-testid="history-detail-back"
            icon={<ArrowLeft aria-hidden="true" />}
          >
            {backLabel}
          </Button>
        ) : null}
        {detail}
      </div>
    </div>
  ) : null;

  return (
    <div
      className={`mf-history-workspace${className ? ` ${className}` : ''}`}
      data-detail-open={detailOpen ? 'true' : 'false'}
      data-testid={testId}
      onFocusCapture={(event) => {
        if (phone && !detailOpen && event.target instanceof HTMLElement) {
          returnFocusTargetRef.current = event.target;
        }
      }}
    >
      <main ref={listRef} className="mf-history-workspace-list">
        {list}
      </main>
      {phone ? (
        <Drawer open={detailOpen} onOpenChange={(open) => !open && onBack?.()}>
          <DrawerContent
            side="bottom"
            hideClose
            className="mf-history-sheet"
            data-testid="history-sheet"
            aria-describedby={undefined}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const target = returnFocusTargetRef.current;
              window.requestAnimationFrame(() => target?.isConnected && target.focus());
            }}
          >
            <DrawerTitle className="mf-sr-only">{backLabel} · 生成详情</DrawerTitle>
            <div className="mf-history-sheet-handle" aria-hidden="true" />
            {detailSurface}
          </DrawerContent>
        </Drawer>
      ) : (
        <aside
          className="mf-history-workspace-inspector"
          aria-label="生成详情"
          aria-hidden={!detailOpen}
          data-testid="history-inspector"
        >
          {detailSurface}
        </aside>
      )}
    </div>
  );
}

function usePhoneHistoryLayout(): boolean {
  const [phone, setPhone] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia(`(max-width: ${PRODUCT_MOBILE_BREAKPOINT}px)`).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(`(max-width: ${PRODUCT_MOBILE_BREAKPOINT}px)`);
    const sync = () => setPhone(media.matches);
    sync();
    media.addEventListener?.('change', sync);
    return () => media.removeEventListener?.('change', sync);
  }, []);

  return phone;
}

export interface GenerationHistoryInspectorPanelProps {
  content: ReactNode;
  actions?: ReactNode;
  notice?: ReactNode;
  error?: ReactNode;
  className?: string;
  testId?: string;
  historyId?: string;
  status?: string;
}

/** Shared inspector scroll/action geometry; hosts inject platform actions. */
export function GenerationHistoryInspectorPanel({
  content,
  actions,
  notice,
  error,
  className,
  testId = 'history-detail',
  historyId,
  status,
}: GenerationHistoryInspectorPanelProps) {
  return (
    <section
      className={`mf-history-inspector-panel${className ? ` ${className}` : ''}`}
      data-testid={testId}
      data-history-id={historyId}
      data-status={status}
    >
      {notice ? <div className="mf-history-inspector-notice">{notice}</div> : null}
      {error ? <div className="mf-history-inspector-error">{error}</div> : null}
      <div className="mf-history-inspector-scroll">{content}</div>
      {actions ? <div className="mf-history-inspector-action-bar">{actions}</div> : null}
    </section>
  );
}
