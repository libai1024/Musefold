import { useEffect, useState } from 'react';
import { Loader2, Power, QrCode, RefreshCw, ShieldCheck, X } from '../../../components/ui/icons';
import type { ValidationResult, DoubaoWebUsageStatus } from '@shared/types/providers';
import { DOUBAO_WEB_DAILY_IMAGE_LIMIT, PROVIDER_PRESETS } from '@shared/constants';
import api from '../../../lib/ipc';
import { Button } from '../../../components/ui/button';
import { useGenerationStore } from '../../generation/store';
import { useDoubaoAccountStore } from '../../account/doubao-store';
import { ValidationResultBanner } from '../../generation/components/ValidationResultBanner';
import { SectionShell, SettingRow } from '../components/SectionShell';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import { toast } from '../../../stores/toast';
import { useSettingsStore } from '../store';

export function DoubaoSection() {
  const providers = useGenerationStore((state) => state.providers);
  const createProvider = useGenerationStore((state) => state.createProvider);
  const loadProviders = useGenerationStore((state) => state.loadProviders);
  const provider = providers.find((item) => item.type === 'doubao-web') ?? null;

  const accountStatus = useDoubaoAccountStore((state) => state.status);
  const refreshStatus = useDoubaoAccountStore((state) => state.refreshStatus);
  const refreshUsage = useDoubaoAccountStore((state) => state.refreshUsage);
  const usage: DoubaoWebUsageStatus | null = accountStatus?.usage ?? null;
  const [busy, setBusy] = useState<'open' | 'refresh' | 'logout' | null>(null);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const loginState = accountStatus?.loginState ?? (provider?.hasKey ? 'logged-in' : 'logged-out');
  const developerMode = useSettingsStore((state) => state.doubaoDeveloperMode);
  const setDeveloperMode = useSettingsStore((state) => state.setDoubaoDeveloperMode);

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
      setResult({ ok: false, code: 'UNKNOWN', message: error instanceof Error ? error.message : '无法准备豆包扫码登录' });
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
    <SectionShell
      title="豆包网页版"
      description="使用本机独立浏览器会话连接豆包会员生图。验证码与安全验证始终由你手动完成。"
      action={
        <div className="flex items-center gap-2">
          {provider?.hasKey && <Button size="sm" variant="ghost" onClick={() => void logout()} disabled={Boolean(busy)}><Power className="h-3.5 w-3.5" />退出登录</Button>}
          <Button size="sm" variant="outline" onClick={openLogin} disabled={Boolean(busy)} data-testid="settings-doubao-open">
            {busy === 'open' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <QrCode className="h-3.5 w-3.5" />}
            {provider?.hasKey ? '重新扫码' : '扫码登录'}
          </Button>
        </div>
      }
    >
      <div className="mb-6 grid gap-px overflow-hidden rounded-lg border border-border-subtle bg-border-subtle sm:grid-cols-3">
          <Fact
          label="豆包账号"
          value={accountStatus?.loggedIn ? accountStatus.accountName || '已连接' : '未登录'}
        />
        <Fact label="今日用量" value={usage ? `${usage.used} / ${usage.limit}` : '读取中'} />
        <Fact label="运行方式" value="后台浏览器" />
      </div>

      <div className="divide-y divide-border-subtle border-y border-border-subtle">
        <SettingRow
          label="网页登录"
          hint="登录信息只保存在专用浏览器分区，不进入 Musefold 数据库、导出文件或日志。"
        >
          <span className="inline-flex items-center gap-1.5 text-[11px] text-secondary">
            <QrCode className="h-3.5 w-3.5" />
            {loginState === 'logged-in' ? '扫码会话可用' : loginState === 'verification-required' ? '需要人工安全验证' : '二维码登录'}
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
          label="开发者选项"
          hint={developerMode
            ? '豆包网页窗口会自动显示，用于排查网页改版、上传和安全验证。'
            : '豆包在后台运行，不显示网页窗口；登录二维码仍在 Musefold 内展示。'}
          data-testid="settings-doubao-developer-row"
        >
          <Button
            size="sm"
            variant={developerMode ? 'primary' : 'outline'}
            onClick={() => setDeveloperMode(!developerMode)}
            role="switch"
            aria-checked={developerMode}
            data-testid="settings-doubao-developer-toggle"
          >
            {developerMode ? '已开启' : '已关闭'}
          </Button>
        </SettingRow>
      </div>

      {result && <ValidationResultBanner className="mt-5" result={result} />}

      {accountStatus?.verificationRequired && <div className="mt-5 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2.5 text-[11px] text-warning"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />请在开发者模式中打开网页完成安全验证；普通用户不会被强制展示豆包网页。</div>}

      <p className="mt-6 text-[10.5px] leading-relaxed text-quaternary">
        登录与验证不会改变当前接入模式。二维码刷新、退出和登录状态同步均在后台专用浏览器会话中完成；二维码只在本窗口短暂显示，不会保存到应用数据或日志。
      </p>

      <Dialog open={loginOpen} onOpenChange={(open) => { if (!open && loginState !== 'logged-in') setLoginOpen(false); }}>
        <DialogContent className="max-w-sm" data-testid="doubao-login-dialog">
          <DialogHeader>
            <DialogTitle>扫码登录豆包</DialogTitle>
            <DialogDescription>使用豆包 App 扫描二维码。扫码状态会自动同步，登录完成后此窗口会自动关闭。</DialogDescription>
          </DialogHeader>
          <div className="flex min-h-[260px] flex-col items-center justify-center gap-4">
            {accountStatus?.qrCodeDataUrl ? <img src={accountStatus.qrCodeDataUrl} alt="豆包登录二维码" className="h-56 w-56 rounded-md border border-border-subtle bg-white p-2" /> : <div className="flex h-56 w-56 flex-col items-center justify-center gap-2 rounded-md border border-border-subtle bg-inset px-4 text-center text-[11px] text-tertiary"><span>{loginState === 'loading' ? '正在准备二维码…' : loginState === 'scanned' ? '已扫码，等待确认…' : '二维码暂不可用'}</span>{loginState === 'error' && <span className="text-[10px] text-secondary">请点击下方“刷新二维码”，应用会重新点击豆包登录页的刷新入口。</span>}</div>}
            <p className="max-w-[280px] text-center text-[11px] text-secondary">{accountStatus?.errorMessage || (loginState === 'qr-ready' ? '等待扫码' : loginState === 'verification-required' ? '等待安全验证' : loginState === 'scanned' ? '已扫码，等待确认' : loginState === 'logged-in' ? '登录成功' : '请稍候')}</p>
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            <Button type="button" variant="ghost" onClick={() => setLoginOpen(false)}><X className="h-3.5 w-3.5" />关闭</Button>
            <Button type="button" variant="outline" onClick={() => void refreshQr()} disabled={Boolean(busy)}><RefreshCw className={busy === 'refresh' ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />刷新二维码</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionShell>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-elevated px-3 py-2.5">
      <p className="text-[9.5px] text-tertiary">{label}</p>
      <p className="mt-0.5 text-[10.5px] text-secondary">{value}</p>
    </div>
  );
}
