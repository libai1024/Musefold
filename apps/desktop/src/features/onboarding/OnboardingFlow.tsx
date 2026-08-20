// src/features/onboarding/OnboardingFlow.tsx
// Musefold 首次使用引导：无卡片全屏工作面，状态机仍由 onboarding store 负责。
// 品牌依据：docs/v0.3/MUSEFOLD-BRAND-PLAN.md §4、§5、§8。

import { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  ExternalLink,
  RefreshCw,
  KeyRound,
  Loader2,
  LockKeyhole,
  QrCode,
  ShieldCheck,
  Sparkles,
  UserRound,
} from '../../components/ui/icons';
import {
  DOUBAO_WEB_DAILY_IMAGE_LIMIT,
  PROVIDER_PRESETS,
  RATIO_OPTIONS,
} from '@musefold/domain/constants';
import type { ImageQuality } from '@musefold/desktop-contracts/enums';
import { useOnboardingStore, EXAMPLE_PROMPT, type OnboardingStep } from './store';
import { useGenerationStore } from '../generation/store';
import { ValidationResultBanner } from '../generation/components/ValidationResultBanner';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { MusefoldLogoAnimated } from '../../components/brand/MusefoldLogoAnimated';
import { formatPoints } from '@musefold/domain';
import { toImageSrc } from '../../lib/media';
import { cn } from '../../lib/utils';
import { usePlatform, useWindowFullscreen } from '../../lib/usePlatform';
import { desktopHost as api } from '@renderer/runtime/desktop-host-services';
import { useDoubaoAccountStore } from '../account/doubao-store';

const QUALITY_OPTIONS: { id: ImageQuality; label: string }[] = [
  { id: 'low', label: '标清' },
  { id: 'medium', label: '高清' },
  { id: 'high', label: '超清' },
];

export function OnboardingFlow() {
  const visible = useOnboardingStore((s) => s.isVisible());
  // isVisible() 内部读取 generation store；必须在本组件订阅，否则那边变化不会重渲染。
  useGenerationStore((s) => s.providersLoaded);
  useGenerationStore((s) => s.providers.length);
  const step = useOnboardingStore((s) => s.step);
  const { isMac } = usePlatform();
  const isFullscreen = useWindowFullscreen();
  const needsMacTitlebarInset = isMac && !isFullscreen;

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[200] bg-background text-primary"
      data-testid="onboarding-flow"
      data-step={step}
    >
      <div className={cn('flex h-full min-h-0 flex-col', needsMacTitlebarInset && 'pt-[52px]')}>
        <OnboardingHeader step={step} />

        <main className="min-h-0 flex-1 overflow-y-auto">
          {/* key 让每一步换页时整块内容重新淡入，衔接更从容 */}
          <div
            key={step}
            className="animate-fade-in mx-auto flex min-h-full w-full max-w-[760px] flex-col justify-center px-6 py-10 sm:px-10 sm:py-14"
          >
            {step === 1 && <StepWelcome />}
            {step === 2 && <StepConnect />}
            {step === 3 && <StepValidate />}
            {step === 4 && <StepFirstImage />}
          </div>
        </main>

        <footer className="flex shrink-0 justify-center border-t border-border-subtle px-6 py-3">
          <p className="flex items-center gap-1.5 text-[11px] text-tertiary">
            <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />
            本地优先 · 登录会话与密钥只保存在本机
          </p>
        </footer>
      </div>
    </div>
  );
}

function OnboardingHeader({ step }: { step: OnboardingStep }) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border-subtle px-5 sm:px-8">
      <div className="flex min-w-0 items-center">
        {step === 1 ? (
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-tertiary">首次设置</span>
        ) : (
          <div className="flex items-center gap-2.5">
            <MusefoldLogoAnimated className="h-7 w-7" />
            <span className="text-[13px] font-semibold tracking-tight text-primary">Musefold</span>
          </div>
        )}
      </div>
      <ProgressDots step={step} />
    </header>
  );
}

function ProgressDots({ step }: { step: OnboardingStep }) {
  return (
    <div
      className="flex items-center gap-3"
      aria-label={`首次设置，第 ${step} 步，共 4 步`}
      data-testid="onboarding-progress"
    >
      <div className="flex items-center gap-1.5" aria-hidden="true">
        {([1, 2, 3, 4] as const).map((n) => (
          <span
            key={n}
            className={cn(
              'h-1 w-5 rounded-full transition-colors duration-[var(--dur-base)]',
              n <= step ? 'bg-primary' : 'bg-border-default',
            )}
          />
        ))}
      </div>
      <span className="font-mono text-[10px] tabular-nums text-tertiary">{step} / 4</span>
    </div>
  );
}

function StepWelcome() {
  const goStart = useOnboardingStore((s) => s.goStart);
  const skip = useOnboardingStore((s) => s.skip);

  return (
    <section className="flex flex-col items-center text-center" data-testid="onboarding-step-1">
      {/* 放大的品牌标记：缓慢入场 + 待机呼吸 */}
      <MusefoldLogoAnimated
        tempo="calm"
        idle
        className="h-[min(190px,26vh)] w-[min(190px,26vh)]"
      />

      {/* 文案与操作错峰浮现，节奏跟随标记的入场 */}
      <div className="animate-slide-up-fade mt-11" style={{ animationDelay: '0.5s' }}>
        <h1 className="text-[30px] font-semibold leading-none tracking-tight text-primary sm:text-[34px]">
          Musefold
        </h1>
        <p className="mt-3 pl-[0.55em] text-[12px] font-medium tracking-[0.55em] text-tertiary">未像</p>
      </div>

      <p
        className="animate-slide-up-fade mt-7 max-w-[460px] text-[15px] leading-7 text-secondary"
        style={{ animationDelay: '0.72s' }}
      >
        让灵感成为图像。保存一个方向，制作一张图。
      </p>

      <div
        className="animate-slide-up-fade mt-10 flex flex-col items-center gap-3 sm:flex-row-reverse"
        style={{ animationDelay: '0.94s' }}
      >
        <Button size="lg" className="rounded-full px-5" onClick={goStart} data-testid="onboarding-start">
          开始设置
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button variant="ghost" size="lg" className="rounded-full px-5" onClick={skip} data-testid="onboarding-skip">
          先进入 Musefold
        </Button>
      </div>

      <p
        className="animate-slide-up-fade mt-12 text-[11px] tracking-[0.02em] text-tertiary"
        style={{ animationDelay: '1.16s' }}
      >
        收集灵感 · 展开想法 · 继续编辑
      </p>
    </section>
  );
}

function StepConnect() {
  const track = useOnboardingStore((s) => s.track);
  const accountStage = useOnboardingStore((s) => s.accountStage);
  const accountBusy = useOnboardingStore((s) => s.accountBusy);
  const accountError = useOnboardingStore((s) => s.accountError);
  const accountQuota = useOnboardingStore((s) => s.accountQuota);
  const presetId = useOnboardingStore((s) => s.presetId);
  const apiKey = useOnboardingStore((s) => s.apiKey);
  const saving = useOnboardingStore((s) => s.saving);
  const alsoConfigureText = useOnboardingStore((s) => s.alsoConfigureText);
  const doubaoWindowOpened = useOnboardingStore((s) => s.doubaoWindowOpened);
  const selectTrack = useOnboardingStore((s) => s.selectTrack);
  const openDoubaoLogin = useOnboardingStore((s) => s.openDoubaoLogin);
  const confirmDoubaoLogin = useOnboardingStore((s) => s.confirmDoubaoLogin);
  const authenticateAccount = useOnboardingStore((s) => s.authenticateAccount);
  const redeemAccount = useOnboardingStore((s) => s.redeemAccount);
  const continueWithoutRedeem = useOnboardingStore((s) => s.continueWithoutRedeem);
  const setPresetId = useOnboardingStore((s) => s.setPresetId);
  const setApiKey = useOnboardingStore((s) => s.setApiKey);
  const setAlsoConfigureText = useOnboardingStore((s) => s.setAlsoConfigureText);
  const connect = useOnboardingStore((s) => s.connect);
  const goBack = useOnboardingStore((s) => s.goBack);
  const skip = useOnboardingStore((s) => s.skip);
  const validation = useOnboardingStore((s) => s.validation);
  const [showKey, setShowKey] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [redeemCode, setRedeemCode] = useState('');
  const doubaoStatus = useDoubaoAccountStore((s) => s.status);
  const refreshDoubaoQr = async () => {
    const snapshot = await api.provider.webLoginRefresh();
    useDoubaoAccountStore.setState({ status: snapshot, loading: false, error: null });
  };

  const preset = PROVIDER_PRESETS.find((p) => p.id === presetId) ?? PROVIDER_PRESETS[0];
  const canContinue = apiKey.trim().length > 0 && !saving;
  const back = () => {
    if (track) {
      useOnboardingStore.setState({
        track: null,
        accountStage: 'choose',
        accountError: null,
        doubaoWindowOpened: false,
        validation: null,
      });
    } else {
      goBack();
    }
  };

  if (!track) {
    return (
      <section className="mx-auto flex w-full max-w-[620px] flex-col" data-testid="onboarding-step-2">
        <StepIntro title="选择连接方式">
          扫码使用已有豆包会员额度，或登录 Musefold 账号使用托管模型。
        </StepIntro>
        <div className="mt-10 divide-y divide-border-subtle border-y border-border-subtle">
          <button
            type="button"
            onClick={() => selectTrack('doubao')}
            className="no-drag group flex min-h-[76px] w-full items-center gap-4 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            data-testid="onboarding-track-doubao"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-inset text-secondary">
              <QrCode className="h-4.5 w-4.5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-[15px] font-medium text-primary">
                豆包扫码登录
                <span className="rounded-full border border-border-default px-2 py-px text-[9px] font-medium text-tertiary">每日 {DOUBAO_WEB_DAILY_IMAGE_LIMIT} 次</span>
              </span>
              <span className="mt-1 block text-[11px] leading-relaxed text-tertiary">
                使用豆包网页版会员生图，无需 API Key；出现安全验证时由你手动完成。
              </span>
            </span>
            <ArrowRight className="h-4 w-4 text-quaternary transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
          </button>
          <button
            type="button"
            onClick={() => selectTrack('account')}
            className="no-drag group flex min-h-[76px] w-full items-center gap-4 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            data-testid="onboarding-track-account"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-inset text-secondary">
              <UserRound className="h-4.5 w-4.5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-[15px] font-medium text-primary">
                登录 Musefold 账号
                <span className="rounded-full border border-border-default px-2 py-px text-[9px] font-medium text-tertiary">稳定推荐</span>
              </span>
              <span className="mt-1 block text-[11px] leading-relaxed text-tertiary">
                一次登录，Agent 与生图模型自动配置，按账号积分使用。
              </span>
            </span>
            <ArrowRight className="h-4 w-4 text-quaternary transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
          </button>
        </div>
        <p className="mt-4 text-[10.5px] leading-relaxed text-quaternary">
          自备 API 与中转站仍可在“设置 → 高级设置”中配置。
        </p>
        <OnboardingActions>
          <Button variant="ghost" size="sm" className="rounded-full shadow-none" onClick={goBack}>
            <ArrowLeft className="h-3.5 w-3.5" /> 上一步
          </Button>
          <Button variant="ghost" size="sm" className="rounded-full shadow-none" onClick={skip} data-testid="onboarding-skip">
            暂时跳过
          </Button>
        </OnboardingActions>
      </section>
    );
  }

  if (track === 'doubao') {
    return (
      <section className="mx-auto flex w-full max-w-[500px] flex-col" data-testid="onboarding-doubao-login">
        <StepIntro title="用豆包扫码连接">
          Musefold 会在这里显示豆包官方二维码。请使用豆包 App 扫码，登录状态会自动同步。
        </StepIntro>

        <div className="mt-9 border-y border-border-subtle py-5">
          <div className="flex items-start gap-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-inset text-secondary">
              <QrCode className="h-4.5 w-4.5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-primary">
                {doubaoStatus?.loggedIn ? '豆包已登录' : doubaoStatus?.loginState === 'qr-ready' ? '等待扫码' : '正在准备二维码'}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-tertiary">
                网页会话保存在本机专用浏览器分区。Musefold 不读取、导出或上传 Cookie。
              </p>
              <p className="mt-2 text-[10.5px] leading-relaxed text-quaternary">
                为减少高频自动化风险，每个本地自然日最多提交 {DOUBAO_WEB_DAILY_IMAGE_LIMIT} 次豆包网页生图；失败请求也计入次数。
              </p>
            </div>
          </div>
        </div>

        {validation && !validation.ok && (
          <div className="mt-5">
            <ValidationResultBanner result={validation} />
          </div>
        )}

        <OnboardingActions>
          <Button variant="ghost" size="sm" className="rounded-full shadow-none" onClick={back}>
            <ArrowLeft className="h-3.5 w-3.5" /> 返回
          </Button>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              className="rounded-full px-4"
              onClick={() => void openDoubaoLogin()}
              disabled={saving}
              data-testid="onboarding-doubao-open"
            >
              {saving && !doubaoWindowOpened ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <QrCode className="h-3.5 w-3.5" />}
              {doubaoWindowOpened ? '重新获取二维码' : '获取登录二维码'}
            </Button>
            {doubaoStatus?.qrCodeDataUrl && <img src={doubaoStatus.qrCodeDataUrl} alt="豆包登录二维码" className="h-40 w-40 rounded-md border border-border-subtle bg-white p-1" />}
            {doubaoStatus?.qrCodeDataUrl && <Button variant="ghost" size="sm" onClick={() => void refreshDoubaoQr()}><RefreshCw className="h-3.5 w-3.5" />刷新二维码</Button>}
            <Button
              className="rounded-full px-4"
              onClick={() => void confirmDoubaoLogin()}
              disabled={!doubaoWindowOpened || saving}
              data-testid="onboarding-doubao-confirm"
            >
              {saving && doubaoWindowOpened ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              {saving && doubaoWindowOpened ? '正在验证…' : '我已完成登录'}
            </Button>
          </div>
        </OnboardingActions>
      </section>
    );
  }

  if (track === 'account') {
    if (accountStage === 'redeem') {
      return (
        <section className="mx-auto flex w-full max-w-[460px] flex-col" data-testid="onboarding-account-redeem">
          <StepIntro title="输入兑换码">
            账号已登录。新账号余额为 0，兑换后即可开始生成。
          </StepIntro>
          <form
            className="mt-9"
            onSubmit={(event) => {
              event.preventDefault();
              void redeemAccount(redeemCode);
            }}
          >
            <label className="text-[11px] font-medium text-secondary" htmlFor="onboarding-redeem-code">兑换码</label>
            <Input
              id="onboarding-redeem-code"
              value={redeemCode}
              onChange={(event) => setRedeemCode(event.target.value)}
              className="mt-2 h-10 rounded-full px-4 font-mono shadow-none"
              autoFocus
              data-testid="onboarding-redeem-code"
            />
            {accountError && <p className="mt-3 border-l border-danger pl-3 text-[11px] text-danger">{accountError}</p>}
            {accountQuota != null && accountQuota > 0 && (
              <p className="mt-3 border-l border-success pl-3 text-[11px] text-success">
                {formatPoints(accountQuota)} 积分已到账
              </p>
            )}
            <p className="mt-3 text-[10.5px] text-quaternary">兑换码请向管理员获取，兑换后即时到账。</p>
            <div className="mt-7 flex items-center justify-between">
              <Button type="button" variant="ghost" size="sm" className="rounded-full shadow-none" onClick={continueWithoutRedeem}>
                稍后兑换
              </Button>
              <Button
                type="submit"
                variant="primary"
                className="rounded-full px-5 shadow-none"
                disabled={accountBusy || !redeemCode.trim()}
              >
                {accountBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {accountBusy ? '兑换中…' : '兑换并继续'}
              </Button>
            </div>
          </form>
        </section>
      );
    }

    return (
      <section className="mx-auto flex w-full max-w-[460px] flex-col" data-testid="onboarding-account-auth">
        <StepIntro title="登录 Musefold">
          登录后自动获取设备令牌，并同时配置 Agent 与生图模型。
        </StepIntro>
        <div className="mt-8 flex border-b border-border-subtle" role="tablist">
          {(['login', 'register'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={authMode === mode}
              onClick={() => setAuthMode(mode)}
              className={cn(
                'no-drag relative pb-2 pr-6 text-[12px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]',
                authMode === mode ? 'text-primary after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-primary' : 'text-tertiary hover:text-primary',
              )}
            >
              {mode === 'login' ? '登录' : '注册'}
            </button>
          ))}
        </div>
        <form
          className="space-y-4 pt-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (authMode === 'register' && password !== confirmPassword) return;
            void authenticateAccount(authMode, { username, password }).finally(() => {
              setPassword('');
              setConfirmPassword('');
            });
          }}
        >
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-medium text-secondary">用户名</span>
            <Input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              maxLength={12}
              autoComplete="username"
              className="h-10 rounded-full px-4 shadow-none"
              data-testid="onboarding-account-username"
              required
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-medium text-secondary">密码</span>
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
              className="h-10 rounded-full px-4 shadow-none"
              data-testid="onboarding-account-password"
              required
            />
          </label>
          {authMode === 'register' && (
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium text-secondary">确认密码</span>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                minLength={8}
                className="h-10 rounded-full px-4 shadow-none"
                aria-invalid={Boolean(confirmPassword && confirmPassword !== password)}
                required
              />
              {confirmPassword && confirmPassword !== password && (
                <span className="mt-1 block text-[10.5px] text-danger">两次输入的密码不一致</span>
              )}
            </label>
          )}
          {accountError && <p className="border-l border-danger pl-3 text-[11px] leading-relaxed text-danger">{accountError}</p>}
          {authMode === 'login' && (
            <p className="text-[10.5px] text-quaternary">忘记密码？联系管理员重置。</p>
          )}
          <OnboardingActions>
            <Button type="button" variant="ghost" size="sm" className="rounded-full shadow-none" onClick={back}>
              <ArrowLeft className="h-3.5 w-3.5" /> 返回
            </Button>
            <Button
              type="submit"
              variant="primary"
              className="rounded-full px-5 shadow-none"
              disabled={accountBusy || (authMode === 'register' && password !== confirmPassword)}
              data-testid="onboarding-account-submit"
            >
              {accountBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {accountBusy ? '正在配置模型…' : authMode === 'login' ? '登录并继续' : '注册并继续'}
            </Button>
          </OnboardingActions>
        </form>
      </section>
    );
  }

  return (
    <section className="mx-auto flex w-full max-w-[620px] flex-col" data-testid="onboarding-step-2">
      <StepIntro title="使用自己的 API">
        直接连接你选择的服务，密钥只保存在这台设备上。
      </StepIntro>

      <fieldset className="mt-9">
        <legend className="mb-1 text-[11px] font-medium text-tertiary">选择服务商</legend>
        {/* CODEX 行式：与轨道选择页同一套 edge-to-edge 分隔线语言，不再用卡片网格。 */}
        <div className="divide-y divide-border-subtle border-y border-border-subtle">
          {PROVIDER_PRESETS.filter((p) => p.type !== 'doubao-web').map((p) => {
            const active = p.id === presetId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPresetId(p.id)}
                aria-pressed={active}
                data-testid={`onboarding-preset-${p.id}`}
                className="no-drag group flex w-full items-center gap-4 py-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
              >
                <span
                  className={cn(
                    'h-2 w-2 shrink-0 rounded-full border transition-colors',
                    active ? 'border-primary bg-primary' : 'border-border-strong bg-transparent group-hover:border-primary',
                  )}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-[12.5px] font-medium text-primary">
                    <span className="truncate">{p.name}</span>
                    {p.recommended && <span className="shrink-0 text-[10px] font-normal text-tertiary">推荐</span>}
                  </span>
                  <span className="mt-0.5 block line-clamp-2 text-[10.5px] leading-relaxed text-tertiary">{p.hint}</span>
                </span>
                {active && <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </fieldset>

      {preset.type === 'openai-compatible' && (
        <label className="mt-5 flex cursor-pointer items-center gap-2 border-y border-border-subtle py-3 text-[11px] text-secondary">
          <input
            type="checkbox"
            checked={alsoConfigureText}
            onChange={(event) => setAlsoConfigureText(event.target.checked)}
            className="h-3.5 w-3.5 accent-current"
            data-testid="onboarding-also-text"
          />
          同时用于 Agent 模型（只输入一次 Key）
        </label>
      )}

      <div className="mt-8">
        <div className="mb-2 flex items-center justify-between gap-3">
          <label htmlFor="onboarding-api-key" className="text-[11px] font-medium text-secondary">API Key</label>
          {preset.keyUrl && (
            <a
              href={preset.keyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="no-drag inline-flex items-center gap-1 text-[11px] text-secondary underline decoration-border-strong underline-offset-2 transition-colors hover:text-primary"
            >
              获取 Key
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          )}
        </div>
        <div className="relative">
          <Input
            id="onboarding-api-key"
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="粘贴你的 API Key"
            autoComplete="off"
            className="h-10 rounded-lg pr-10 text-[13px]"
            data-testid="onboarding-api-key"
          />
          <button
            type="button"
            onClick={() => setShowKey((s) => !s)}
            className="no-drag absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-tertiary transition-colors hover:bg-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
            title={showKey ? '隐藏 API Key' : '显示 API Key'}
          >
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-[10.5px] leading-relaxed text-tertiary">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>连接地址已按预设填好。密钥使用系统级加密保存，不会写入应用数据。</span>
        </p>
      </div>

      {validation && !validation.ok && (
        <div className="mt-5">
          <ValidationResultBanner result={{ ok: false, code: validation.code, message: validation.message }} />
        </div>
      )}

      <OnboardingActions>
        <Button variant="ghost" size="sm" className="rounded-full" onClick={back} data-testid="onboarding-back">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          上一步
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="rounded-full" onClick={skip} data-testid="onboarding-skip">暂时跳过</Button>
          <Button className="rounded-full px-4" onClick={connect} disabled={!canContinue} data-testid="onboarding-connect">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
            {saving ? '正在保存…' : '校验并继续'}
            {!saving && <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />}
          </Button>
        </div>
      </OnboardingActions>
    </section>
  );
}

function StepValidate() {
  const validating = useOnboardingStore((s) => s.validating);
  const validation = useOnboardingStore((s) => s.validation);
  const textValidation = useOnboardingStore((s) => s.textValidation);
  const textConnectionId = useOnboardingStore((s) => s.textConnectionId);
  const track = useOnboardingStore((s) => s.track);
  const alsoConfigureText = useOnboardingStore((s) => s.alsoConfigureText);
  const presetId = useOnboardingStore((s) => s.presetId);
  const accountQuota = useOnboardingStore((s) => s.accountQuota);
  const goBack = useOnboardingStore((s) => s.goBack);
  const skip = useOnboardingStore((s) => s.skip);
  const retryValidate = useOnboardingStore((s) => s.retryValidate);
  const providerId = useOnboardingStore((s) => s.providerId);

  const continueToImage = () => useOnboardingStore.setState({ step: 4 });
  const updateKey = () => useOnboardingStore.setState({ step: 2 });
  const preset = PROVIDER_PRESETS.find((item) => item.id === presetId);
  const requiresText = track === 'account'
    || Boolean(track === 'byok' && alsoConfigureText && preset?.type === 'openai-compatible');
  const allOk = Boolean(validation?.ok && (!requiresText || textValidation?.ok));

  return (
    <section className="mx-auto flex w-full max-w-[560px] flex-col" data-testid="onboarding-step-3">
      <StepIntro title="确认连接">
        先确认服务可以正常响应，再开始制作第一张图。
      </StepIntro>

      <div className="mt-10 min-h-[156px]">
        {validating && (
          <div className="flex min-h-[156px] flex-col items-center justify-center gap-3 text-center" data-testid="onboarding-validating">
            <Loader2 className="h-6 w-6 animate-spin text-secondary" />
            <p className="text-[13px] text-secondary">
              {track === 'doubao' ? '正在确认豆包网页会话…' : '正在确认 Agent 与生图模型…'}
            </p>
          </div>
        )}

        {!validating && (validation || textValidation) && (
          <div className="divide-y divide-border-subtle border-y border-border-subtle">
            {(textConnectionId || textValidation) && (
              <ValidationLine
                label="Agent 模型"
                ok={textValidation?.ok ?? false}
                detail={textValidation?.message ?? '尚未确认'}
              />
            )}
            <ValidationLine
              label="图像生成"
              ok={validation?.ok ?? false}
              detail={validation?.message ?? '尚未确认'}
            />
            {accountQuota != null && (
              <ValidationLine
                label="账号余额"
                ok={accountQuota > 0}
                detail={accountQuota > 0 ? `${formatPoints(accountQuota)} 积分` : '0 积分，可稍后兑换'}
              />
            )}
          </div>
        )}

        {!validating && validation && !validation.ok && (
          <div className="mt-4 w-full" data-testid="onboarding-validation-error">
            <ValidationResultBanner
              result={{ ok: false, code: validation.code, message: validation.message, modelCount: validation.models?.length }}
              onAction={(action) => {
                if (action.kind === 'update_key') updateKey();
                else if (action.kind === 'retry') void retryValidate();
              }}
            />
          </div>
        )}
      </div>

      <OnboardingActions>
        <Button variant="ghost" size="sm" className="rounded-full" onClick={goBack} data-testid="onboarding-back">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          上一步
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="rounded-full" onClick={skip} data-testid="onboarding-skip">暂时跳过</Button>
          {allOk ? (
            <Button className="rounded-full px-4" onClick={continueToImage} data-testid="onboarding-continue">
              继续
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          ) : (
            !validating && providerId && (
              <Button variant="outline" className="rounded-full px-4" onClick={() => void retryValidate()} data-testid="onboarding-retry">
                重新确认
              </Button>
            )
          )}
        </div>
      </OnboardingActions>
    </section>
  );
}

function ValidationLine({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-center gap-3 py-3.5 text-left">
      {ok
        ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
        : <AlertCircle className="h-4 w-4 shrink-0 text-danger" />}
      <span className="min-w-0 flex-1 text-[12px] font-medium text-primary">{label}</span>
      <span className={cn('max-w-[58%] break-words text-right text-[10.5px] leading-relaxed', ok ? 'text-tertiary' : 'text-danger')} title={detail}>
        {detail}
      </span>
    </div>
  );
}

function StepFirstImage() {
  const track = useOnboardingStore((s) => s.track);
  const ratioId = useOnboardingStore((s) => s.ratioId);
  const quality = useOnboardingStore((s) => s.quality);
  const generating = useOnboardingStore((s) => s.generating);
  const generateError = useOnboardingStore((s) => s.generateError);
  const generatedImagePath = useOnboardingStore((s) => s.generatedImagePath);
  const setRatioId = useOnboardingStore((s) => s.setRatioId);
  const setQuality = useOnboardingStore((s) => s.setQuality);
  const generateFirstImage = useOnboardingStore((s) => s.generateFirstImage);
  const finish = useOnboardingStore((s) => s.finish);
  const [broken, setBroken] = useState(false);

  useEffect(() => setBroken(false), [generatedImagePath]);

  return (
    <section className="mx-auto flex w-full max-w-[620px] flex-col" data-testid="onboarding-step-4">
      <StepIntro title="让第一个方向显形">
        我们已经准备好一条示例提示词。选择画幅，看看它会变成什么。
      </StepIntro>

      <p className="mt-9 border-l border-border-strong pl-4 font-mono text-[12px] leading-6 text-secondary">
        {EXAMPLE_PROMPT}
      </p>

      <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
        <OptionGroup label="画幅">
          {RATIO_OPTIONS.filter((r) => r.id !== 'auto').slice(0, 5).map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRatioId(r.id)}
              aria-pressed={ratioId === r.id}
              data-testid={`onboarding-ratio-${r.id}`}
              className={cn(
                'no-drag rounded-full border px-2.5 py-1 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]',
                ratioId === r.id
                  ? 'border-primary bg-primary text-background'
                  : 'border-border-default bg-elevated text-secondary hover:border-border-strong hover:text-primary',
              )}
            >
              {r.label}
            </button>
          ))}
        </OptionGroup>

        {track !== 'doubao' && <OptionGroup label="质量">
          {QUALITY_OPTIONS.map((q) => (
            <button
              key={q.id}
              type="button"
              onClick={() => setQuality(q.id)}
              aria-pressed={quality === q.id}
              data-testid={`onboarding-quality-${q.id}`}
              className={cn(
                'no-drag rounded-full border px-2.5 py-1 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]',
                quality === q.id
                  ? 'border-primary bg-primary text-background'
                  : 'border-border-default bg-elevated text-secondary hover:border-border-strong hover:text-primary',
              )}
            >
              {q.label}
            </button>
          ))}
        </OptionGroup>}
      </div>

      {!generatedImagePath && (
        <Button
          className="mt-10 self-start rounded-full px-5"
          size="lg"
          onClick={() => void generateFirstImage()}
          disabled={generating}
          data-testid="onboarding-generate"
        >
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {generating
            ? track === 'doubao' ? '豆包正在生成（最长约 3 分钟）…' : '正在显形（约 10-30 秒）…'
            : '生成第一张图'}
        </Button>
      )}

      {generateError && !generating && (
        <p className="mt-4 flex items-start gap-1.5 text-[11px] leading-relaxed text-danger" data-testid="onboarding-generate-error">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {generateError.message}
        </p>
      )}

      {generatedImagePath && !broken && (
        <div className="mt-8 flex flex-col items-start gap-3" data-testid="onboarding-result">
          <img
            src={toImageSrc(generatedImagePath)}
            alt="你的第一张图"
            onError={() => setBroken(true)}
            className="max-h-[300px] max-w-full rounded-xl border border-border-default object-contain"
            data-testid="onboarding-result-image"
          />
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-success">
            <Check className="h-4 w-4" />
            第一张图已加入生成历史
          </p>
        </div>
      )}

      <div className="mt-10 flex justify-end">
        <Button className="rounded-full px-4" onClick={finish} disabled={!generatedImagePath} data-testid="onboarding-finish">
          完成，进入创作
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>
    </section>
  );
}

function StepIntro({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-normal text-primary">{title}</h2>
      <p className="mt-2 max-w-[520px] text-[13px] leading-6 text-secondary">{children}</p>
    </div>
  );
}

function OnboardingActions({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-12 flex items-center justify-between gap-3 border-t border-border-subtle pt-4">
      {children}
    </div>
  );
}

function OptionGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-wrap items-center gap-1.5">
      <legend className="mr-1 text-[11px] text-tertiary">{label}</legend>
      {children}
    </fieldset>
  );
}
