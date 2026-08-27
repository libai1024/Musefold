import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Loader2,
  Power,
  QrCode,
  RefreshCw,
  ShieldCheck,
  X,
} from '../../../components/ui/icons';
import type { ValidationResult, DoubaoWebUsageStatus } from '@musefold/desktop-contracts/providers';
import { DOUBAO_WEB_DAILY_IMAGE_LIMIT, PROVIDER_PRESETS } from '@musefold/domain/constants';
import { desktopHost as api } from '@renderer/runtime/desktop-host-services';
import { Button } from '../../../components/ui/button';
import { SettingsSwitch } from '@musefold/product-ui';
import { useGenerationStore } from '@renderer/runtime/generation-access';
import { useAccountStore, useDoubaoAccountStore } from '@renderer/runtime/account-access';
import { ValidationResultBanner } from '@renderer/runtime/generation-access';
import { SettingRow, SettingsCard } from '../components/SectionShell';
import { InlineMessage } from './account-section-ui';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { toast } from '../../../stores/toast';
import { useSettingsStore } from '../store';

export function DoubaoSection() {
  const providers = useGenerationStore((state) => state.providers);
  const createProvider = useGenerationStore((state) => state.createProvider);
  const loadProviders = useGenerationStore((state) => state.loadProviders);
  const provider = providers.find((item) => item.type === 'doubao-web') ?? null;
  const officialLoggedIn = useAccountStore((state) => state.status.loggedIn);

  const accountStatus = useDoubaoAccountStore((state) => state.status);
  const refreshStatus = useDoubaoAccountStore((state) => state.refreshStatus);
  const refreshUsage = useDoubaoAccountStore((state) => state.refreshUsage);
  const usage: DoubaoWebUsageStatus | null = accountStatus?.usage ?? null;
  const [busy, setBusy] = useState<'open' | 'refresh' | 'logout' | null>(null);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const loginState = accountStatus?.loginState ?? (provider?.hasKey ? 'logged-in' : 'logged-out');
  const foreground = useSettingsStore((state) => state.doubaoForeground);
  const setForeground = useSettingsStore((state) => state.setDoubaoForeground);
  // 低频解释性尾注走渐进披露：默认单行摘要，按需展开限制说明。
  const [limitsExpanded, setLimitsExpanded] = useState(false);

  useEffect(() => {
    if (provider?.hasKey) void refreshStatus().catch(() => refreshUsage().catch(() => {}));
    else void refreshUsage().catch(() => {});
  }, [provider?.hasKey, refreshStatus, refreshUsage]);

  const ensureProvider = async (): Promise<string> => {
    if (provider) return provider.id;
    const preset = PROVIDER_PRESETS.find((item) => item.type === 'doubao-web');
    if (!preset) throw new Error('豆包网页预设不存在');
    const created = await createProvider({
      name: preset.name,
      type: preset.type,
      baseUrl: preset.baseUrl,
      model: preset.model,
      isActive: providers.length === 0,
    });
    return created.id;
  };

  const openLogin = async () => {
    if (busy) return;
    setBusy('open');
    setResult(null);
    try {
      await ensureProvider();
      const snapshot = await api.provider.webLoginStart();
      useDoubaoAccountStore.setState({ status: snapshot, loading: false, error: null });
      setLoginOpen(true);
    } catch (error) {
      setResult({
        ok: false,
        code: 'UNKNOWN',
        message: error instanceof Error ? error.message : '无法准备豆包扫码登录',
      });
    } finally {
      setBusy(null);
    }
  };

  const refreshQr = async () => {
    if (busy) return;
    setBusy('refresh');
    try {
      const snapshot = await api.provider.webLoginRefresh();
      useDoubaoAccountStore.setState({ status: snapshot, loading: false, error: null });
    } catch (error) {
      toast.error('二维码刷新失败', error instanceof Error ? error.message : '请稍后重试');
    } finally {
      setBusy(null);
    }
  };

  const logout = async () => {
    if (busy) return;
    setBusy('logout');
    try {
      const snapshot = await api.provider.webLogout();
      useDoubaoAccountStore.setState({ status: snapshot, loading: false, error: null });
      await loadProviders();
      setLoginOpen(false);
      toast.success('豆包已退出登录');
    } catch (error) {
      toast.error('豆包退出失败', error instanceof Error ? error.message : '请稍后重试');
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    const unsubscribe = api.provider.onWebLoginChanged((snapshot) => {
      useDoubaoAccountStore.setState({ status: snapshot, loading: false, error: null });
      if (snapshot.loggedIn) {
        setLoginOpen(false);
        void loadProviders();
        toast.success('豆包登录成功', snapshot.accountName || '已同步账号状态');
      }
    });
    return unsubscribe;
  }, [loadProviders]);

  return (
    <>
      <SettingsCard
        title="豆包 · 体验通道"
        description={`官方账号的备用生图通道；每个自然日最多提交 ${DOUBAO_WEB_DAILY_IMAGE_LIMIT} 次，降低账号风控风险。`}
        action={
          <div className="flex items-center gap-2">
            {provider?.hasKey && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void logout()}
                disabled={Boolean(busy)}
              >
                <Power className="h-3.5 w-3.5" />
                退出登录
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={openLogin}
              disabled={Boolean(busy)}
              data-testid="settings-doubao-open"
            >
              {busy === 'open' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <QrCode className="h-3.5 w-3.5" />
              )}
              {provider?.hasKey ? '重新扫码' : '扫码登录'}
            </Button>
          </div>
        }
      >
        {officialLoggedIn && (
          <p className="px-6 pt-2 text-meta leading-relaxed text-tertiary">
            已登录官方账号，推荐优先使用官方通道；官方不可用时可切换豆包应急。
          </p>
        )}
        <div className="settings-facts">
          <Fact
            label="豆包账号"
            value={accountStatus?.loggedIn ? accountStatus.accountName || '已连接' : '未登录'}
          />
          <Fact label="今日用量" value={usage ? `${usage.used} / ${usage.limit}` : '读取中'} />
          <Fact label="运行方式" value="后台浏览器" />
        </div>
        <SettingRow
          label="网页登录"
          hint="登录信息只保存在专用浏览器分区，不进入 Musefold 数据库、导出文件或日志。"
        >
          <span className="inline-flex items-center gap-1.5 text-[11px] text-secondary">
            {/* 图标随状态而非随功能：已登录/待验证用语义状态图标，二维码仅留给待扫码态。 */}
            {loginState === 'logged-in' ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" />
            ) : loginState === 'verification-required' ? (
              <ShieldCheck className="h-3.5 w-3.5 text-warning" aria-hidden="true" />
            ) : (
              <QrCode className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {loginState === 'logged-in'
              ? '扫码会话可用'
              : loginState === 'verification-required'
                ? '需要人工安全验证'
                : '二维码登录'}
          </span>
        </SettingRow>
        <SettingRow
          label="每日保护限制"
          hint={`每个本地自然日最多提交 ${DOUBAO_WEB_DAILY_IMAGE_LIMIT} 次；失败请求同样计数，次日自动重置。`}
        >
          <span className="font-mono text-[11px] tabular-nums text-secondary">
            {usage ? `剩余 ${usage.remaining} 次` : '—'}
          </span>
        </SettingRow>
        <SettingRow
          label="豆包前台"
          hint={
            foreground
              ? '正在显示豆包网页前台，可实时查看后台自动化过程；下次启动自动恢复后台运行。'
              : '豆包在后台隐藏运行，登录二维码仍在应用内展示。'
          }
          data-testid="settings-doubao-developer-row"
        >
          <SettingsSwitch
            checked={foreground}
            onCheckedChange={setForeground}
            label="豆包前台"
            testId="settings-doubao-developer-toggle"
          />
        </SettingRow>
      </SettingsCard>

      {result && <ValidationResultBanner className="mt-5" result={result} />}

      {accountStatus?.verificationRequired && (
        <InlineMessage tone="warning" className="mt-5">
          请打开「豆包前台」显示豆包网页并完成安全验证；普通用户不会被强制展示豆包网页。
        </InlineMessage>
      )}

      <p className="mt-6 text-meta leading-relaxed text-quaternary">
        二维码仅在登录窗口短暂显示，不写入应用数据与日志。
        <Button
          type="button"
          unstyled
          className="no-drag ml-2 text-meta text-tertiary underline-offset-4 hover:text-primary hover:underline"
          aria-expanded={limitsExpanded}
          onClick={() => setLimitsExpanded((value) => !value)}
        >
          {limitsExpanded ? '收起限制说明' : '查看限制说明'}
        </Button>
      </p>
      {limitsExpanded && (
        <p className="mt-1 text-meta leading-relaxed text-quaternary">
          登录与验证不会改变当前接入模式。二维码刷新、退出和登录状态同步均在后台专用浏览器会话中完成。
        </p>
      )}

      <Dialog
        open={loginOpen}
        onOpenChange={(open) => {
          if (!open && loginState !== 'logged-in') setLoginOpen(false);
        }}
      >
        <DialogContent className="max-w-sm" data-testid="doubao-login-dialog">
          <DialogHeader>
            <DialogTitle>扫码登录豆包</DialogTitle>
            <DialogDescription>
              使用豆包 App 扫描二维码。扫码状态会自动同步，登录完成后此窗口会自动关闭。
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex min-h-[260px] flex-col items-center justify-center gap-4">
            {accountStatus?.qrCodeDataUrl ? (
              <img
                src={accountStatus.qrCodeDataUrl}
                alt="豆包登录二维码"
                className="h-56 w-56 rounded-md border border-border-subtle bg-white p-2"
              />
            ) : (
              <div className="flex h-56 w-56 flex-col items-center justify-center gap-2 rounded-md border border-border-subtle bg-inset px-4 text-center text-[11px] text-tertiary">
                <span>
                  {loginState === 'loading'
                    ? '正在准备二维码…'
                    : loginState === 'scanned'
                      ? '已扫码，等待确认…'
                      : '二维码暂不可用'}
                </span>
                {loginState === 'error' && (
                  <span className="text-meta text-secondary">
                    请点击下方「刷新二维码」，应用会重新点击豆包登录页的刷新入口。
                  </span>
                )}
              </div>
            )}
            <p className="max-w-[280px] text-center text-[11px] text-secondary">
              {accountStatus?.errorMessage ||
                (loginState === 'qr-ready'
                  ? '等待扫码'
                  : loginState === 'verification-required'
                    ? '等待安全验证'
                    : loginState === 'scanned'
                      ? '已扫码，等待确认'
                      : loginState === 'logged-in'
                        ? '登录成功'
                        : '请稍候')}
            </p>
          </DialogBody>
          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            <Button type="button" variant="ghost" onClick={() => setLoginOpen(false)}>
              <X className="h-3.5 w-3.5" />
              关闭
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void refreshQr()}
              disabled={Boolean(busy)}
            >
              <RefreshCw
                className={busy === 'refresh' ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'}
              />
              刷新二维码
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-elevated px-3 py-2.5">
      <p className="text-meta text-tertiary">{label}</p>
      <p className="mt-0.5 text-meta text-secondary">{value}</p>
    </div>
  );
}
