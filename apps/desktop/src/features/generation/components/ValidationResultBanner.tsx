// src/features/generation/components/ValidationResultBanner.tsx
// 测试连接结果条：按错误码展示友好文案 + 可执行下一步（TASK-GEN-03）

import { Check, AlertCircle, KeyRound, ExternalLink, RotateCcw } from '../../../components/ui/icons';
import { errorGuidance, type ErrorAction } from '@musefold/domain/errors';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';

export interface ValidationBannerModel {
  ok: boolean;
  /** 主进程原始/友好 message */
  message?: string;
  /** 归一化错误码 */
  code?: string;
  /** 成功时可用的模型数（可选展示） */
  modelCount?: number;
}

interface Props {
  result: ValidationBannerModel;
  className?: string;
  /** 打开说明 / 充值页（通常是预设 keyUrl） */
  docsUrl?: string | null;
  onAction?: (action: ErrorAction) => void;
}

export function ValidationResultBanner({ result, className, docsUrl, onAction }: Props) {
  if (result.ok) {
    return (
      <div
        className={cn(
          'flex items-start gap-1.5 rounded-md bg-success/10 px-2.5 py-2 text-[11px] leading-relaxed text-success',
          className
        )}
        data-testid="validation-result"
        data-ok="true"
      >
        <Check className="mt-0.5 h-3 w-3 shrink-0" />
        <div className="min-w-0">
          <p className="font-medium">{result.message || '连接成功'}</p>
          {typeof result.modelCount === 'number' && result.modelCount > 0 && (
            <p className="mt-0.5 text-success/80">探测到 {result.modelCount} 个模型</p>
          )}
        </div>
      </div>
    );
  }

  const guidance = errorGuidance(result.code);
  const detail = result.message?.trim();
  const showDetail =
    detail &&
    detail !== guidance.title &&
    !guidance.title.includes(detail) &&
    !detail.includes(guidance.title);

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-md bg-danger/10 px-2.5 py-2 text-[11px] leading-relaxed text-danger',
        className
      )}
      data-testid="validation-result"
      data-ok="false"
      data-error-code={result.code ?? 'UNKNOWN'}
    >
      <div className="flex items-start gap-1.5">
        <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
        <div className="min-w-0">
          <p className="font-medium" data-testid="validation-title">
            {guidance.title}
          </p>
          <p className="mt-0.5 text-danger/85" data-testid="validation-hint">
            {guidance.hint}
          </p>
          {showDetail && (
            <p className="mt-1 font-mono text-[10px] text-danger/70" data-testid="validation-detail">
              {detail}
            </p>
          )}
        </div>
      </div>

      {guidance.actions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pl-4">
          {guidance.actions.map((action) => {
            const needsUrl = action.kind === 'open_url';
            if (needsUrl && !docsUrl) return null;
            return (
              <Button
                key={`${action.kind}-${action.label}`}
                size="xs"
                variant="outline"
                className="h-6 border-danger/25 bg-elevated/60 text-danger hover:bg-danger/10"
                data-testid={`validation-action-${action.kind}`}
                onClick={() => onAction?.(action)}
              >
                {actionIcon(action.kind)}
                {action.label}
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function actionIcon(kind: ErrorAction['kind']) {
  switch (kind) {
    case 'update_key':
      return <KeyRound className="h-3 w-3" />;
    case 'open_url':
      return <ExternalLink className="h-3 w-3" />;
    case 'retry':
      return <RotateCcw className="h-3 w-3" />;
    default:
      return null;
  }
}
