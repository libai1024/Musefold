'use client';

import { Badge } from '@musefold/ui/components/badge';
import { DoubaoMark, MusefoldMark } from '@musefold/ui/components/brand-mark';
import { Button } from '@musefold/ui/components/button';
import { Input } from '@musefold/ui/components/input';
import { Label } from '@musefold/ui/components/label';
import { Skeleton } from '@musefold/ui/components/skeleton';
import { Spinner } from '@musefold/ui/components/spinner';
import { KeyRound, RefreshCw } from '@musefold/ui/icons';
import { useCapabilities } from '@musefold/platform';
import { type FormEvent, useState } from 'react';
import {
  useCreateAiProvider,
  useDoubaoAccountStatus,
  useLogin,
  useRefreshDoubaoLogin,
  useRegister,
  useStartDoubaoLogin,
} from '../account/hooks';
import type { OnboardingTrack } from './onboarding-store';
import {
  errorMessage,
  OnboardingActions,
  OnboardingStepBody,
  OnboardingTrackRow,
} from './onboarding-ui';

export interface OnboardingConnectProps {
  track: OnboardingTrack | null;
  onSelectTrack: (track: OnboardingTrack) => void;
  /** 连接落地(账号登录 / BYOK 建连 / 豆包登录成功)后进入 validate。 */
  onConnected: (result: { track: OnboardingTrack; providerId?: string }) => void;
  onBack: () => void;
  onSkip: () => void;
}

/**
 * connect 步:三轨连接。
 * 轨道可见性只由 capability 决定 —— Web 只显示官方账号轨,不伪造本地 BYOK / 豆包入口。
 */
export function OnboardingStepConnect(props: OnboardingConnectProps) {
  const capabilities = useCapabilities();

  if (props.track === 'account') return <AccountTrack {...props} />;
  if (props.track === 'byok' && capabilities.hasLocalAiProviders) return <ByokTrack {...props} />;
  if (props.track === 'doubao' && capabilities.hasDoubaoWebLogin) return <DoubaoTrack {...props} />;

  return (
    <section className="flex flex-col gap-5" data-testid="onboarding-step-connect">
      <OnboardingStepBody
        title="连接一个生图通道"
        description="选一种方式就能开始;之后随时可在「设置 → 账号与连接」里增改。"
      >
        <div className="flex flex-col gap-2">
          <OnboardingTrackRow
            testId="onboarding-track-account"
            icon={<MusefoldMark className="size-4 [--primary:currentColor]" aria-hidden />}
            title="登录 Musefold 账号"
            badge={<Badge variant="secondary">推荐</Badge>}
            description="一次登录即可用官方托管的生图与 Agent 模型,按账号积分计费。"
            onSelect={() => props.onSelectTrack('account')}
          />
          {capabilities.hasLocalAiProviders && (
            <OnboardingTrackRow
              testId="onboarding-track-byok"
              icon={<KeyRound className="size-4" aria-hidden />}
              title="使用自己的 API"
              description="填入 OpenAI 兼容网关的地址与密钥;密钥只保存在本机系统安全存储。"
              onSelect={() => props.onSelectTrack('byok')}
            />
          )}
          {capabilities.hasDoubaoWebLogin && (
            <OnboardingTrackRow
              testId="onboarding-track-doubao"
              icon={<DoubaoMark className="size-4" aria-hidden />}
              title="豆包免费试用"
              badge={<Badge variant="outline">每日免费额度</Badge>}
              description="扫码登录豆包网页账号,用它的每日免费生图额度试一试,无需 API Key。"
              onSelect={() => props.onSelectTrack('doubao')}
            />
          )}
        </div>
      </OnboardingStepBody>
      <OnboardingActions onBack={props.onBack} onSkip={props.onSkip} />
    </section>
  );
}

/** ① 官方账号轨:内联登录/注册(复用 account 域 hooks,凭据经 gateway.account 委托校验)。 */
function AccountTrack({ onConnected, onBack, onSkip }: OnboardingConnectProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  // 确认密码是纯 UI 态:只用于提交前比对,不进 gateway payload。
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const login = useLogin();
  const register = useRegister();
  const active = mode === 'login' ? login : register;
  const pending = login.isPending || register.isPending;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password || pending) return;
    if (mode === 'register' && password !== confirmPassword) {
      setMismatch(true);
      return;
    }
    active.mutate(
      { username: username.trim(), password },
      {
        onSuccess: () => {
          setPassword('');
          setConfirmPassword('');
          onConnected({ track: 'account' });
        },
      },
    );
  };

  return (
    <section className="flex flex-col gap-5" data-testid="onboarding-step-connect">
      <OnboardingStepBody
        title={mode === 'login' ? '登录 Musefold 账号' : '注册 Musefold 账号'}
        description="登录后官方托管的生图与 Agent 模型自动就绪,按账号积分使用。"
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={handleSubmit}
          data-testid="onboarding-account-form"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="onboarding-account-username">用户名</Label>
            <Input
              id="onboarding-account-username"
              data-testid="onboarding-account-username"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="onboarding-account-password">密码</Label>
            <Input
              id="onboarding-account-password"
              data-testid="onboarding-account-password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              aria-invalid={mismatch || undefined}
              onChange={(event) => {
                setPassword(event.target.value);
                setMismatch(false);
              }}
            />
          </div>
          {mode === 'register' && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="onboarding-account-confirm">确认密码</Label>
              <Input
                id="onboarding-account-confirm"
                data-testid="onboarding-account-confirm"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                aria-invalid={mismatch || undefined}
                onChange={(event) => {
                  setConfirmPassword(event.target.value);
                  setMismatch(false);
                }}
              />
            </div>
          )}
          {mismatch && (
            <p className="text-destructive text-sm" role="alert">
              两次输入的密码不一致
            </p>
          )}
          {active.isError && (
            <p className="text-destructive text-sm" data-testid="onboarding-account-error">
              {errorMessage(active.error)}
            </p>
          )}
          <Button
            type="button"
            variant="link"
            className="h-auto self-start p-0 text-muted-foreground text-xs"
            disabled={pending}
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setConfirmPassword('');
              setMismatch(false);
            }}
            data-testid="onboarding-account-switch-mode"
          >
            {mode === 'login' ? '没有账号?注册' : '已有账号?登录'}
          </Button>
          <OnboardingActions onBack={onBack} onSkip={onSkip}>
            <Button
              type="submit"
              disabled={pending || !username.trim() || !password}
              data-testid="onboarding-next"
            >
              {pending && <Spinner className="size-3.5" />}
              {mode === 'login' ? '登录并继续' : '注册并继续'}
            </Button>
          </OnboardingActions>
        </form>
      </OnboardingStepBody>
    </section>
  );
}

/**
 * ② 桌面 BYOK 轨:自备 OpenAI 兼容网关。
 * 复用 `useCreateAiProvider`(仅 `hasLocalAiProviders` 宿主提供该域),
 * API Key 随入参一次性交给宿主写系统安全存储 —— 不进本模块任何 store。
 */
function ByokTrack({ onConnected, onBack, onSkip }: OnboardingConnectProps) {
  const [name, setName] = useState('我的中转站');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const create = useCreateAiProvider();
  const valid = name.trim() && baseUrl.trim() && model.trim() && apiKey.trim();

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid || create.isPending) return;
    create.mutate(
      {
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        apiKey: apiKey.trim(),
        // 首启建的第一条连接直接设为默认,工作台 Composer 立即可用。
        activate: true,
      },
      {
        onSuccess: (provider) => {
          setApiKey('');
          onConnected({ track: 'byok', providerId: provider.id });
        },
      },
    );
  };

  return (
    <section className="flex flex-col gap-5" data-testid="onboarding-step-connect">
      <OnboardingStepBody
        title="使用自己的 API"
        description="填入 OpenAI 兼容网关的信息。密钥经系统安全存储保存在本机,不写入数据库、导出文件或日志。"
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={handleSubmit}
          data-testid="onboarding-byok-form"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="onboarding-byok-name">名称</Label>
            <Input
              id="onboarding-byok-name"
              data-testid="onboarding-byok-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="onboarding-byok-base-url">Base URL</Label>
            <Input
              id="onboarding-byok-base-url"
              data-testid="onboarding-byok-base-url"
              placeholder="https://example.com/v1"
              autoComplete="off"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="onboarding-byok-model">模型</Label>
            <Input
              id="onboarding-byok-model"
              data-testid="onboarding-byok-model"
              placeholder="gemini-2.5-flash-image"
              autoComplete="off"
              value={model}
              onChange={(event) => setModel(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="onboarding-byok-api-key">API Key</Label>
            <Input
              id="onboarding-byok-api-key"
              data-testid="onboarding-byok-api-key"
              type="password"
              autoComplete="off"
              placeholder="粘贴你的 API Key"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </div>
          {create.isError && (
            <p className="text-destructive text-sm" data-testid="onboarding-byok-error">
              {errorMessage(create.error)}
            </p>
          )}
          <OnboardingActions onBack={onBack} onSkip={onSkip}>
            <Button
              type="submit"
              disabled={!valid || create.isPending}
              data-testid="onboarding-next"
            >
              {create.isPending && <Spinner className="size-3.5" />}
              保存并继续
            </Button>
          </OnboardingActions>
        </form>
      </OnboardingStepBody>
    </section>
  );
}

/**
 * ③ 豆包免费试用轨(桌面专属,`hasDoubaoWebLogin`)。
 * 只调用既有冻结面适配 hooks(startLogin / refreshLogin / getStatus 轮询),
 * 不触碰豆包内部实现;登录成功即进 validate。
 */
function DoubaoTrack({ onConnected, onBack, onSkip }: OnboardingConnectProps) {
  const status = useDoubaoAccountStatus();
  const start = useStartDoubaoLogin();
  const refresh = useRefreshDoubaoLogin();
  const pending = start.isPending || refresh.isPending;
  const loggedIn = status.data?.loggedIn === true;

  return (
    <section className="flex flex-col gap-5" data-testid="onboarding-step-connect">
      <OnboardingStepBody
        title="豆包免费试用"
        description="扫码登录豆包网页账号即可使用它的每日免费生图额度。登录信息只保存在专用浏览器分区。"
      >
        <div className="flex flex-col gap-3" data-testid="onboarding-doubao-track">
          {status.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : status.isError ? (
            <p className="text-destructive text-sm" data-testid="onboarding-doubao-error">
              {errorMessage(status.error)}
            </p>
          ) : status.data.loginState === 'qr-ready' && status.data.qrCodeDataUrl ? (
            <div className="flex items-start gap-3">
              <img
                src={status.data.qrCodeDataUrl}
                alt="豆包登录二维码"
                className="size-32 shrink-0 rounded-md border bg-white p-1"
                data-testid="onboarding-doubao-qr"
              />
              <p className="pt-1 text-muted-foreground text-xs leading-5">
                打开豆包 App 扫码登录。二维码约两分钟过期,失效后点「刷新二维码」。
              </p>
            </div>
          ) : (
            <p
              className="flex items-center gap-2 text-muted-foreground text-sm"
              data-testid="onboarding-doubao-hint"
            >
              {(status.data.loginState === 'loading' || status.data.loginState === 'scanned') && (
                <Spinner className="size-3.5" />
              )}
              {loggedIn
                ? `已登录${status.data.accountName ? ` ${status.data.accountName}` : ''},今日剩余 ${status.data.usage.remaining}/${status.data.usage.limit} 次`
                : status.data.loginState === 'loading'
                  ? '正在获取登录二维码…'
                  : status.data.loginState === 'scanned'
                    ? '已扫码,请在豆包 App 内确认登录'
                    : status.data.loginState === 'verification-required'
                      ? '豆包要求人工验证,请在豆包窗口中完成验证后刷新二维码'
                      : '还未登录。扫码登录后即可用每日免费额度出图。'}
            </p>
          )}
          {status.data?.errorMessage && (
            <p className="text-destructive text-xs" role="alert">
              {status.data.errorMessage}
            </p>
          )}
          {!loggedIn && status.isSuccess && (
            <div className="flex justify-start">
              {status.data.loginState === 'logged-out' ? (
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() => start.mutate()}
                  data-testid="onboarding-doubao-start"
                >
                  {start.isPending && <Spinner className="size-3.5" />}
                  扫码登录
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => refresh.mutate()}
                  data-testid="onboarding-doubao-refresh"
                >
                  {refresh.isPending ? (
                    <Spinner className="size-3.5" />
                  ) : (
                    <RefreshCw className="size-3.5" />
                  )}
                  刷新二维码
                </Button>
              )}
            </div>
          )}
        </div>
      </OnboardingStepBody>
      <OnboardingActions onBack={onBack} onSkip={onSkip}>
        <Button
          disabled={!loggedIn}
          onClick={() => onConnected({ track: 'doubao' })}
          data-testid="onboarding-next"
        >
          继续
        </Button>
      </OnboardingActions>
    </section>
  );
}
