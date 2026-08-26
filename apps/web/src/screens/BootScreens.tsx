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
import { WebGatewayError, type WebGateway } from '../runtime';

export type AccountAccessMode = 'login' | 'register';

export interface AccountFormDraft {
  username: string;
  password: string;
  passwordConfirmation: string;
}

type AccountFormField = keyof AccountFormDraft;
export type AccountFormErrors = Partial<Record<AccountFormField, string>>;
type AccountAccessGateway = Pick<WebGateway, 'login' | 'register'>;

const emptyAccountForm: AccountFormDraft = {
  username: '',
  password: '',
  passwordConfirmation: '',
};

export function validateAccountForm(
  mode: AccountAccessMode,
  draft: AccountFormDraft,
): AccountFormErrors {
  const errors: AccountFormErrors = {};
  if (!draft.username.trim()) errors.username = '请输入账号';
  if (!draft.password) errors.password = '请输入密码';
  if (mode === 'register') {
    if (!draft.passwordConfirmation) {
      errors.passwordConfirmation = '请再次输入密码';
    } else if (draft.password !== draft.passwordConfirmation) {
      errors.passwordConfirmation = '两次输入的密码不一致';
    }
  }
  return errors;
}

export function accountAccessErrorMessage(cause: unknown, mode: AccountAccessMode): string {
  if (!(cause instanceof WebGatewayError)) {
    return mode === 'login' ? '暂时无法登录，请稍后重试' : '暂时无法注册，请稍后重试';
  }

  switch (cause.code) {
    case 'AUTH_CREDENTIALS_INVALID':
      return '账号或密码不正确，请检查后重试';
    case 'AUTH_REGISTRATION_DISABLED':
      return '暂时无法注册，请使用已有账号登录';
    case 'RATE_LIMITED':
      return '操作过于频繁，请稍后再试';
    case 'VALIDATION_FAILED':
      return mode === 'register'
        ? '该账号暂时无法注册，请更换账号后重试'
        : '账号或密码格式不正确，请检查后重试';
    case 'AUTH_REQUIRED':
    case 'AUTH_SESSION_EXPIRED':
      return '登录状态已更新，请重新提交';
    default:
      return '账号服务暂时不可用，请稍后重试';
  }
}

export async function submitAccountAccess({
  gateway,
  mode,
  username,
  password,
  returnTo,
  currentOrigin,
  navigate,
  onAuthenticated,
}: {
  gateway: AccountAccessGateway;
  mode: AccountAccessMode;
  username: string;
  password: string;
  returnTo: string | null;
  currentOrigin: string;
  navigate: (target: string) => void;
  onAuthenticated: () => void;
}): Promise<void> {
  const credentials = { username: username.trim(), password };
  if (mode === 'login') {
    await gateway.login(credentials);
  } else {
    await gateway.register(credentials);
  }

  const safeReturnTo = getSafeOAuthReturnTo(returnTo, currentOrigin);
  if (safeReturnTo) {
    navigate(safeReturnTo);
    return;
  }
  onAuthenticated();
}

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
  initialMode = 'login',
}: {
  gateway: AccountAccessGateway;
  onAuthenticated: () => void;
  initialMode?: AccountAccessMode;
}) {
  const [mode, setMode] = useState<AccountAccessMode>(initialMode);
  const [draft, setDraft] = useState<AccountFormDraft>(emptyAccountForm);
  const [fieldErrors, setFieldErrors] = useState<AccountFormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchMode = (nextMode: AccountAccessMode) => {
    if (submitting || nextMode === mode) return;
    setMode(nextMode);
    setDraft((current) => ({
      ...current,
      password: '',
      passwordConfirmation: '',
    }));
    setFieldErrors({});
    setError(null);
  };

  const handleModeKeyDown = (key: string) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(key)) return;
    const nextMode = mode === 'login' ? 'register' : 'login';
    switchMode(nextMode);
    window.requestAnimationFrame(() => document.getElementById(`account-${nextMode}-tab`)?.focus());
  };

  const setField = (field: AccountFormField, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    const nextErrors = validateAccountForm(mode, draft);
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    setError(null);
    try {
      await submitAccountAccess({
        gateway,
        mode,
        username: draft.username,
        password: draft.password,
        returnTo: new URLSearchParams(window.location.search).get('returnTo'),
        currentOrigin: window.location.origin,
        navigate: (target) => window.location.assign(target),
        onAuthenticated,
      });
    } catch (cause) {
      setError(accountAccessErrorMessage(cause, mode));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-screen grid min-h-full place-items-center bg-elevated p-[24px]">
      <form
        className="login-form w-full max-w-[360px] rounded-md border border-solid border-default bg-elevated p-[26px] shadow-pop"
        onSubmit={(event) => void submit(event)}
        noValidate
        aria-busy={submitting}
      >
        <div className="flex items-center gap-[9px]">
          <img className="h-[28px] w-[28px] object-contain" src={musefoldIconUrl} alt="" />
          <div className="grid leading-[1.15]">
            <strong className="text-[14px] font-[650]">Musefold</strong>
            <span className="text-meta text-tertiary">未像</span>
          </div>
        </div>
        <div className="login-tabs" role="tablist" aria-label="账户访问方式">
          {(['login', 'register'] as const).map((candidate) => {
            const label = candidate === 'login' ? '登录' : '注册';
            return (
              <button
                key={candidate}
                id={`account-${candidate}-tab`}
                className="login-tab"
                type="button"
                role="tab"
                aria-controls="account-access-panel"
                aria-selected={mode === candidate}
                tabIndex={mode === candidate ? 0 : -1}
                disabled={submitting}
                onClick={() => switchMode(candidate)}
                onKeyDown={(event) => {
                  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
                  event.preventDefault();
                  handleModeKeyDown(event.key);
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div id="account-access-panel" role="tabpanel" aria-labelledby={`account-${mode}-tab`}>
          <h1>{mode === 'login' ? '登录个人账户' : '注册个人账户'}</h1>
          <label>
            <span>账号</span>
            <Input
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={draft.username}
              disabled={submitting}
              aria-invalid={Boolean(fieldErrors.username)}
              aria-describedby={fieldErrors.username ? 'account-username-error' : undefined}
              onChange={(event) => setField('username', event.target.value)}
            />
            {fieldErrors.username ? (
              <span id="account-username-error" className="login-field-error">
                {fieldErrors.username}
              </span>
            ) : null}
          </label>
          <label>
            <span>密码</span>
            <Input
              name="password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={draft.password}
              disabled={submitting}
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby={fieldErrors.password ? 'account-password-error' : undefined}
              onChange={(event) => setField('password', event.target.value)}
            />
            {fieldErrors.password ? (
              <span id="account-password-error" className="login-field-error">
                {fieldErrors.password}
              </span>
            ) : null}
          </label>
          {mode === 'register' ? (
            <label>
              <span>确认密码</span>
              <Input
                name="passwordConfirmation"
                type="password"
                autoComplete="new-password"
                value={draft.passwordConfirmation}
                disabled={submitting}
                aria-invalid={Boolean(fieldErrors.passwordConfirmation)}
                aria-describedby={
                  fieldErrors.passwordConfirmation
                    ? 'account-password-confirmation-error'
                    : undefined
                }
                onChange={(event) => setField('passwordConfirmation', event.target.value)}
              />
              {fieldErrors.passwordConfirmation ? (
                <span id="account-password-confirmation-error" className="login-field-error">
                  {fieldErrors.passwordConfirmation}
                </span>
              ) : null}
            </label>
          ) : null}
          {error ? (
            <p className="form-error login-form-error" role="alert">
              {error}
            </p>
          ) : null}
          <Button
            variant="primary"
            className="button button-primary login-submit"
            type="submit"
            disabled={submitting}
          >
            {submitting ? (
              <LoaderCircle className="spin" aria-hidden="true" />
            ) : (
              <CircleUserRound aria-hidden="true" />
            )}
            {submitting
              ? mode === 'login'
                ? '正在登录'
                : '正在注册'
              : mode === 'login'
                ? '登录'
                : '注册'}
          </Button>
        </div>
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
