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
    <div className="center-screen" role="status" aria-live="polite">
      <img className="loading-mark" src={musefoldIconUrl} alt="" />
      <LoaderCircle className="spin" aria-hidden="true" />
      <span>正在载入</span>
    </div>
  );
}

export function FailureScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="center-screen">
      <img className="loading-mark" src={musefoldIconUrl} alt="Musefold" />
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
    <main className="login-screen">
      <form className="login-form" onSubmit={(event) => void submit(event)}>
        <div className="brand-lockup brand-lockup-login">
          <img src={musefoldIconUrl} alt="" />
          <div>
            <strong>Musefold</strong>
            <span>未像</span>
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
    <main className="approval-screen">
      <div className="approval-panel">
        <div className="brand-lockup brand-lockup-login">
          <img src={musefoldIconUrl} alt="" />
          <div>
            <strong>Musefold</strong>
            <span>Cloud MCP</span>
          </div>
        </div>
        <h1>确认这次生图</h1>
        {loading && (
          <div className="generation-progress">
            <LoaderCircle className="spin" aria-hidden="true" />
            <span>正在载入任务</span>
          </div>
        )}
        {job && (
          <>
            <p className="approval-prompt">{job.request.prompt}</p>
            <div className="approval-facts">
              <span>来源：Cloud MCP</span>
              <span>
                状态：
                {job.status === 'pending_approval' ? '等待确认' : job.status}
              </span>
            </div>
            <Button
              variant="primary"
              className="button button-primary"
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
              className="approval-result"
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
