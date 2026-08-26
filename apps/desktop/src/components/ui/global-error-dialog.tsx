import { useState } from 'react';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';
import { Button } from './button';
import { AlertCircle, Check, Copy } from './icons';
import { useErrorStore, diagnosticText, type DiagnosticItem } from '../../stores/errors';

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy browser clipboard path.
  }

  try {
    const element = document.createElement('textarea');
    element.value = text;
    element.setAttribute('readonly', '');
    element.style.position = 'fixed';
    element.style.opacity = '0';
    document.body.appendChild(element);
    element.select();
    const copied = document.execCommand('copy');
    element.remove();
    return copied;
  } catch {
    return false;
  }
}

function ErrorDetails({ item }: { item: DiagnosticItem }) {
  const report = item.report;
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="rounded-md border border-danger/25 bg-danger/5 px-3 py-2">
        <p className="break-words text-sm font-medium text-primary">{report.error.message}</p>
        <p className="mt-1 text-[11px] text-secondary">
          {report.error.name}
          {report.error.code ? ` · ${report.error.code}` : ''}
          {item.occurrences > 1 ? ` · 已发生 ${item.occurrences} 次` : ''}
        </p>
      </div>
      <details className="min-h-0 overflow-hidden rounded-md border border-border-default bg-inset">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-secondary hover:text-primary">
          查看技术详情
        </summary>
        <pre className="max-h-[34vh] overflow-auto border-t border-border-default px-3 py-2 font-mono text-meta leading-relaxed text-secondary whitespace-pre-wrap break-words">
          {diagnosticText(item)}
        </pre>
      </details>
    </div>
  );
}

export function GlobalErrorDialog() {
  const item = useErrorStore((state) => state.items[0]);
  const dismiss = useErrorStore((state) => state.dismiss);
  const [copied, setCopied] = useState(false);

  const close = () => {
    if (item) dismiss(item.report.id);
    setCopied(false);
  };

  const copy = async () => {
    if (!item) return;
    const success = await copyText(diagnosticText(item));
    setCopied(success);
    if (!success) window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <Dialog open={Boolean(item)} onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="max-w-xl gap-3"
        data-testid="global-error-dialog"
        aria-describedby="global-error-description"
      >
        <DialogHeader className="pr-7">
          <DialogTitle className="flex items-center gap-2 text-danger">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            发生未预期错误
          </DialogTitle>
          <DialogDescription id="global-error-description">
            应用捕获到一个异常。请复制错误信息，便于定位问题。
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="gap-2">{item && <ErrorDetails item={item} />}</DialogBody>
        <DialogFooter className="pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={copy}
            data-testid="global-error-copy"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {copied ? '已复制' : '复制错误信息'}
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={close}
            data-testid="global-error-close"
          >
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
