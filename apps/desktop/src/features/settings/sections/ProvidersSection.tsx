// src/features/settings/sections/ProvidersSection.tsx
// 高级设置：生图中转站管理。
import { useMemo, useState } from 'react';
import { Plus, Check, Trash2, Pencil, Zap, Loader2, KeyRound, ListChecks } from '../../../components/ui/icons';
import type { ProviderConfig } from '@musefold/desktop-contracts/models';
import type { ErrorAction } from '@musefold/domain/errors';
import { PROVIDER_PRESETS } from '@musefold/domain/constants';
import { useGenerationStore } from '../../generation/store';
import { Button } from '../../../components/ui/button';
import { ModelBrandIcon } from '../../../components/ui/brand-icons';
import { displayModelName } from '../../../lib/model-catalog';
import { SectionShell } from '../components/SectionShell';
import { ConnectionRow, InlineConfirm } from '../components/ConnectionRow';
import { ValidationResultBanner } from '../../generation/components/ValidationResultBanner';
import { ProviderEmptyGuide } from '../../generation/components/ProviderEmptyGuide';
import { accessModeOfProvider } from '../../../lib/ai-access';

export function ProvidersSection() {
  const providers = useGenerationStore((s) => s.providers);
  const activeProviderId = useGenerationStore((s) => s.activeProviderId);
  const openProviderDialog = useGenerationStore((s) => s.openProviderDialog);
  const testStatus = useGenerationStore((s) => s.testStatus);
  const testingAll = useGenerationStore((s) => s.testingAll);
  const testAll = useGenerationStore((s) => s.testAll);
  const stationProviders = useMemo(
    () => providers.filter((provider) => provider.managedBy !== 'account' && provider.type !== 'doubao-web'),
    [providers],
  );
  const activeProvider = providers.find((provider) => provider.id === activeProviderId) ?? providers[0] ?? null;
  const relayMode = accessModeOfProvider(activeProvider) === 'relay';

  // 汇总当前列表内各 Provider 的测试结果（忽略已删除 Provider 的残留状态）
  const summary = useMemo(() => {
    let ok = 0;
    let failed = 0;
    let skipped = 0;
    let tested = 0;
    for (const p of stationProviders) {
      const st = testStatus[p.id]?.state;
      if (st === 'ok') { ok += 1; tested += 1; }
      else if (st === 'failed') { failed += 1; tested += 1; }
      else if (st === 'skipped') { skipped += 1; tested += 1; }
    }
    return { ok, failed, skipped, tested };
  }, [stationProviders, testStatus]);

  return (
    <SectionShell
      title="生图中转站"
      description="高级接入：配置 OpenAI 兼容服务或其他生图网关。密钥仅保存在本机系统密钥链。"
      action={
        <div className="flex items-center gap-2">
          {stationProviders.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => testAll()} disabled={testingAll}>
              {testingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListChecks className="h-3.5 w-3.5" />}
              测试全部
            </Button>
          )}
          <Button size="sm" variant="primary" onClick={() => openProviderDialog()} data-testid="settings-provider-new">
            <Plus className="h-3.5 w-3.5" /> 新建服务商
          </Button>
        </div>
      }
    >
      {/* 边界事实卡：与 Agent 模型分区同构（v0.3.3 术语：两条独立模型通道） */}
      <div className="mb-6 grid gap-px overflow-hidden rounded-lg border border-border-subtle bg-border-subtle sm:grid-cols-3" data-testid="settings-provider-boundary">
        <BoundaryFact label="用途" value="制作工作台与方案运行的图像生成" />
        <BoundaryFact label="计费" value="由服务商或网关决定" />
        <BoundaryFact label="权限" value="仅调用生图接口" />
      </div>

      {stationProviders.length === 0 ? (
        <ProviderEmptyGuide context="settings" testId="settings-empty-provider" />
      ) : (
        <div className="settings-list flex flex-col">
          {(summary.tested > 0 || testingAll) && (
            <div className="flex items-center gap-3 border-y border-border-subtle py-2.5 text-[11.5px]">
              {testingAll && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />}
              <span className="font-medium text-secondary">
                {testingAll ? '正在测试全部服务商…' : '测试结果'}
              </span>
              <span className="flex items-center gap-2.5 text-tertiary">
                <span className="text-success">{summary.ok} 正常</span>
                <span className="text-quaternary">·</span>
                <span className={summary.failed > 0 ? 'text-danger' : ''}>{summary.failed} 失败</span>
                <span className="text-quaternary">·</span>
                <span>{summary.skipped} 跳过（无密钥）</span>
              </span>
            </div>
          )}
          {stationProviders.map((p) => (
            <ProviderRow key={p.id} provider={p} active={p.id === activeProviderId} relayMode={relayMode} />
          ))}
        </div>
      )}
    </SectionShell>
  );
}

function ProviderRow({ provider, active, relayMode }: { provider: ProviderConfig; active: boolean; relayMode: boolean }) {
  const setActive = useGenerationStore((s) => s.setActive);
  const deleteProvider = useGenerationStore((s) => s.deleteProvider);
  const openProviderDialog = useGenerationStore((s) => s.openProviderDialog);
  const testProvider = useGenerationStore((s) => s.testProvider);
  const test = useGenerationStore((s) => s.testStatus[provider.id]);

  const [confirmDel, setConfirmDel] = useState(false);
  const testing = test?.state === 'testing';
  const showResult = test && (test.state === 'ok' || test.state === 'failed' || test.state === 'skipped');
  const isDoubaoWeb = provider.type === 'doubao-web';

  return (
    <ConnectionRow
      active={active}
      icon={<ModelBrandIcon model={provider.model} className="h-4 w-4" />}
      title={provider.name}
      meta={
        <>
          <span className="max-w-full truncate">{isDoubaoWeb ? '独立浏览器会话' : provider.baseUrl}</span>
          <span className="text-quaternary">·</span>
          <span title={provider.model}>{displayModelName(provider.model)}</span>
          <span className="text-quaternary">·</span>
          {provider.hasKey
            ? <span>{isDoubaoWeb ? '豆包已登录' : provider.keySuffix ? `Key ····${provider.keySuffix}` : '已配置密钥'}</span>
            : <span className="text-warning">{isDoubaoWeb ? '需要登录' : '缺少密钥'}</span>}
        </>
      }
      status={
        showResult && test!.state === 'skipped' ? (
          <p className="mt-2 flex items-start gap-1.5 rounded-md bg-inset px-2 py-1.5 text-[11px] leading-relaxed text-tertiary">
            <KeyRound className="mt-0.5 h-3 w-3 shrink-0" />
            {test!.message ?? '未配置密钥'}
            <button
              type="button"
              className="ml-auto text-accent hover:underline"
              data-testid="provider-row-add-key"
              onClick={() => openProviderDialog(provider)}
            >
              去填写
            </button>
          </p>
        ) : showResult ? (
          <ValidationResultBanner
            className="mt-2"
            result={{
              ok: test!.state === 'ok',
              message: test!.message,
              code: test!.code,
            }}
            docsUrl={resolveDocsUrl(provider)}
            onAction={(action) => handleRowAction(action, provider)}
          />
        ) : undefined
      }
      actions={
        <>
          {relayMode && !active && (
            <Button size="sm" variant="ghost" onClick={() => setActive(provider.id)}>
              <Check className="h-3 w-3" /> 设为默认
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => testProvider(provider.id)} disabled={testing}>
            {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
            测试连接
          </Button>
          <Button size="sm" variant="ghost" onClick={() => openProviderDialog(provider)}>
            <Pencil className="h-3 w-3" /> 编辑
          </Button>
        </>
      }
      trailing={
        confirmDel ? (
          <InlineConfirm label="确认删除？" confirmLabel="删除" danger onConfirm={() => deleteProvider(provider.id)} onCancel={() => setConfirmDel(false)} />
        ) : (
          <Button size="iconSm" variant="ghost" className="text-tertiary hover:text-danger" aria-label={`删除 ${provider.name}`} title="删除服务商" onClick={() => setConfirmDel(true)}>
            <Trash2 className="h-3 w-3" />
          </Button>
        )
      }
    />
  );
}


/** 按 Provider type/baseUrl 反查预设的说明/充值链接 */
function resolveDocsUrl(provider: ProviderConfig): string | undefined {
  const match =
    PROVIDER_PRESETS.find((p) => p.type === provider.type && p.baseUrl === provider.baseUrl) ??
    PROVIDER_PRESETS.find((p) => p.type === provider.type) ??
    PROVIDER_PRESETS.find((p) => p.baseUrl === provider.baseUrl);
  return match?.keyUrl;
}

function BoundaryFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-elevated px-3 py-2.5">
      <p className="text-[9.5px] text-tertiary">{label}</p>
      <p className="mt-0.5 text-[10.5px] text-secondary">{value}</p>
    </div>
  );
}

function handleRowAction(action: ErrorAction, provider: ProviderConfig): void {
  const { openProviderDialog, testProvider } = useGenerationStore.getState();
  switch (action.kind) {
    case 'update_key':
      openProviderDialog(provider);
      break;
    case 'open_url': {
      const url = resolveDocsUrl(provider);
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
      break;
    }
    case 'retry':
      void testProvider(provider.id);
      break;
    case 'check_model':
      openProviderDialog(provider);
      break;
    default:
      break;
  }
}
