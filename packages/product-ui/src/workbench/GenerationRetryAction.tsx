import { IconButton } from '@musefold/legacy-ui';
import { RefreshCw } from '@musefold/legacy-ui/icons';

export interface GenerationRetryActionProps {
  onRetry: () => void;
  disabled?: boolean;
  busy?: boolean;
  className?: string;
  testId?: string;
}

/** Shared retry control for generation cards across Desktop and Web. */
export function GenerationRetryAction({
  onRetry,
  disabled = false,
  busy = false,
  className,
  testId = 'result-retry',
}: GenerationRetryActionProps) {
  return (
    <IconButton
      size="xs"
      label={busy ? '重试中' : '重试'}
      className={['mf-generation-retry-action', className].filter(Boolean).join(' ')}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      onClick={onRetry}
      data-testid={testId}
    >
      <RefreshCw className={busy ? 'mf-spin' : undefined} aria-hidden="true" />
    </IconButton>
  );
}
