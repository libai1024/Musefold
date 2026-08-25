import { useState, type FormEvent } from 'react';
import { Check, CircleUserRound, LoaderCircle } from '@musefold/ui/icons';
import type { GenerationJob } from '@musefold/contracts';
import {
  GenerationResultSurface,
  workbenchGenerationResultStatus,
  workbenchGenerationStatusLabel,
} from '@musefold/product-ui';
import { Button, Input } from '@musefold/ui';
import musefoldIconUrl from '../../../../website/Musefold/assets/musefold-icon.png';
import { getSafeOAuthReturnTo } from '../oauth-return-to';
import type { WebGateway } from '../runtime';

export function LoadingScreen() {
  return (
    <div
      className="grid min-h-full place-items-center content-center gap-[10px] bg-elevated p-[24px] text-center text-[11px] text-secondary"
      role="status"
      aria-live="polite"
    >
      <img className="h-[38px] w-[38px] object-contain" src={musefoldIconUrl} alt="" />
      <LoaderCircle className="spin" aria-hidden="true" />
      <span>正在载入</span>
    </div>
  );
}

export function FailureScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="grid min-h-full place-items-center content-center gap-[10px] bg-elevated p-[24px] text-center text-[11px] text-secondary">
      <img className="h-[38px] w-[38px] object-contain" src={musefoldIconUrl} alt="Musefold" />
      <strong>暂时无法连接</strong>
      <span>{message}</span>
      <Button variant="primary" className="button button-primary" type="button" onClick={onRetry}>
        重试
      </Button>
    </div>
  );
}

export function LoginScreen({
  gateway,
  onAuthenticated,
}: {
  gateway: WebGateway;
  onAuthenticated: () => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await gateway.login({ username, password });
      const returnTo = getSafeOAuthReturnTo(
        new URLSearchParams(window.location.search).get('returnTo'),
        window.location.origin,
      );
      if (returnTo) {
        window.location.assign(returnTo);
        return;
      }
      onAuthenticated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登录失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-screen grid min-h-full place-items-center bg-elevated p-[24px]">
      <form
        className="login-form w-full max-w-[360px] rounded-md border border-solid border-default bg-elevated p-[26px] shadow-pop"
        onSubmit={(event) => void submit(event)}
      >
        <div className="flex items-center gap-[9px]">
          <img className="h-[28px] w-[28px] object-contain" src={musefoldIconUrl} alt="" />
          <div className="grid leading-[1.15]">
            <strong className="text-[14px] font-[650]">Musefold</strong>
            <span className="text-meta text-tertiary">未像</span>
          </div>
        </div>
        <h1>登录个人账户</h1>
        <label>
          <span>账号</span>
          <Input
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
        <label>
          <span>密码</span>
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Button
          variant="primary"
          className="button button-primary login-submit"
          type="submit"
          disabled={submitting || !username || !password}
        >
          {submitting ? (
            <LoaderCircle className="spin" aria-hidden="true" />
          ) : (
            <CircleUserRound aria-hidden="true" />
          )}
          登录
        </Button>
      </form>
    </main>
  );
}

export function ApprovalScreen({
  job,
  loading,
  error,
  onApprove,
}: {
  job: GenerationJob | null;
  loading: boolean;
  error: string | null;
  onApprove: () => Promise<void>;
}) {
  const [approving, setApproving] = useState(false);
  const approve = async () => {
    setApproving(true);
    try {
      await onApprove();
    } finally {
      setApproving(false);
    }
  };
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-[24px]">
      <div className="w-full max-w-[460px] rounded-md border border-solid border-default bg-elevated p-[24px] shadow-pop">
        <div className="flex items-center gap-[9px]">
          <img className="h-[28px] w-[28px] object-contain" src={musefoldIconUrl} alt="" />
          <div className="grid leading-[1.15]">
            <strong className="text-[14px] font-[650]">Musefold</strong>
            <span className="text-meta text-tertiary">Cloud MCP</span>
          </div>
        </div>
        <h1 className="mt-[25px] mb-[14px] text-[17px] font-semibold">确认这次生图</h1>
        {loading && (
          <div className="mt-[8px] flex min-h-[96px] items-center gap-[8px] text-[11px] text-tertiary">
            <LoaderCircle className="spin text-accent" aria-hidden="true" />
            <span>正在载入任务</span>
          </div>
        )}
        {job && (
          <>
            <p className="approval-prompt m-0 rounded-[7px] bg-inset p-[11px] text-[12px] leading-[1.55] text-secondary whitespace-pre-wrap">
              {job.request.prompt}
            </p>
            <div className="approval-facts my-[13px] mb-[18px] flex flex-wrap gap-x-[14px] gap-y-[8px] text-meta text-tertiary">
              <span>来源：Cloud MCP</span>
              <span>
                状态：
                {job.status === 'pending_approval' ? '等待确认' : job.status}
              </span>
            </div>
            <Button
              variant="primary"
              className="button button-primary approval-submit"
              type="button"
              disabled={approving || job.status !== 'pending_approval'}
              onClick={() => void approve()}
            >
              {approving ? (
                <LoaderCircle className="spin" aria-hidden="true" />
              ) : (
                <Check aria-hidden="true" />
              )}
              {job.status === 'pending_approval' ? '允许生成' : '已处理'}
            </Button>
            <GenerationResultSurface
              className="mt-[16px]"
              testId="approval-generation-result"
              imageTestId="approval-generation-result-image"
              status={workbenchGenerationResultStatus(job.status)}
              imageUrl={job.assets[0]?.url ?? null}
              imageAlt="Musefold Cloud MCP 生图结果"
              imageLabel="查看生图结果"
              imageTitle="查看生图结果"
              aspectRatio={job.request.aspectRatio ?? '1:1'}
              progressLabel={`${workbenchGenerationStatusLabel(job.status)}${job.progress > 0 ? ` ${job.progress}%` : ''}`}
              footerLabel={workbenchGenerationStatusLabel(job.status)}
              onOpenImage={
                job.assets[0]
                  ? () => window.open(job.assets[0].url, '_blank', 'noopener')
                  : undefined
              }
              errorMessage={job.error?.message}
            />
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
