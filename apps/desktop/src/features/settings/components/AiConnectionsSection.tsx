// src/features/settings/components/AiConnectionsSection.tsx
// Agent 模型 —— 为设计方案 Agent 提供文本能力的连接管理。
import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  KeyRound,
  Loader2,
  MessageSquareText,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Unplug,
} from '../../../components/ui/icons';
import type { AiConnectionProfile } from '@musefold/desktop-contracts/ai';
import { Button } from '../../../components/ui/button';
import { displayModelName } from '../../../lib/model-catalog';
import { ModelBrandIcon } from '../../../components/ui/brand-icons';
import { desktopHost as api } from '@renderer/runtime/desktop-host-services';
import { toast } from '../../../stores/toast';
import { AI_CONNECTION_RESTART_REQUIRED } from '../ai-connection-errors';
import { useAiConnectionStore } from '../ai-connection-store';
import { AiConnectionDialog } from '../components/AiConnectionDialog';
import { ConnectionRow, InlineConfirm } from '../components/ConnectionRow';
import { SectionShell } from '../components/SectionShell';
import { useGenerationStore } from '../../generation/store';
import { accessModeOfProvider } from '../../../lib/ai-access';

export function AiConnectionsSection() {
  const connections = useAiConnectionStore((state) => state.connections);
  const presets = useAiConnectionStore((state) => state.presets);
  const loaded = useAiConnectionStore((state) => state.loaded);
  const loading = useAiConnectionStore((state) => state.loading);
  const error = useAiConnectionStore((state) => state.error);
  const load = useAiConnectionStore((state) => state.load);
  const openDialog = useAiConnectionStore((state) => state.openDialog);
  const providers = useGenerationStore((state) => state.providers);
  const activeProviderId = useGenerationStore((state) => state.activeProviderId);
  const stationConnections = useMemo(
    () => connections.filter((connection) => connection.managedBy !== 'account'),
    [connections],
  );
  const activeProvider = providers.find((provider) => provider.id === activeProviderId) ?? providers[0] ?? null;
  const relayMode = accessModeOfProvider(activeProvider) === 'relay';

  useEffect(() => {
    if (!loaded && !loading) void load().catch(() => {});
  }, [load, loaded, loading]);

  return (
    <SectionShell
      title="Agent 中转站"
      description="高级接入：配置 Agent 使用的文本模型网关。账号 Agent 模型由 Musefold 固定管理，不会自动生图、读取未授权文件或发布方案。"
      action={
        <Button size="sm" variant="primary" onClick={() => openDialog()} data-testid="settings-ai-new">
          <Plus className="h-3.5 w-3.5" /> 添加连接
        </Button>
      }
    >
      <div className="mb-6 grid gap-px overflow-hidden rounded-lg border border-border-subtle bg-border-subtle sm:grid-cols-3" data-testid="settings-ai-boundary">
        <BoundaryFact label="用途" value="创建与修改设计方案" />
        <BoundaryFact label="计费" value="由服务商或网关计费" />
        <BoundaryFact label="权限" value="无工具、无文件、不会生图" />
      </div>

      {loading && !loaded ? (
        <div className="flex min-h-36 items-center justify-center gap-2 text-[11px] text-tertiary" data-testid="settings-ai-loading">
          <Loader2 className="h-4 w-4 animate-spin" /> 正在读取 AI 连接…
        </div>
      ) : error && stationConnections.length === 0 ? (
        <div className="rounded-md border border-danger/35 bg-danger/5 px-4 py-4" role="alert" data-testid="settings-ai-error">
          <p className="text-[12px] font-medium text-danger">AI 连接读取失败</p>
          <p className="mt-1 text-[10.5px] text-secondary">{error}</p>
          <div className="mt-3 flex gap-2">
            {error === AI_CONNECTION_RESTART_REQUIRED && (
              <Button size="sm" variant="primary" onClick={() => void api.system.relaunch()} data-testid="settings-ai-relaunch">
                立即重启
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => void load()}>重试</Button>
          </div>
        </div>
      ) : stationConnections.length === 0 ? (
        <div className="border-y border-border-subtle px-0 py-5" data-testid="settings-ai-empty">
          <div className="flex items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-inset text-secondary">
              <MessageSquareText className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium text-primary">连接一个可用的文本模型</p>
              <p className="mt-1 max-w-[62ch] text-[10.5px] leading-relaxed text-tertiary">
                API Key 由你提供并在本机加密保存。没有连接也不影响空白搭建、Prompt 标注、YAML 或 Skill 手动导入。
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {presets.slice(0, 6).map((preset) => (
                  <Button
                    key={preset.id}
                    size="sm"
                    variant={preset.recommended ? 'primary' : 'outline'}
                    onClick={() => openDialog(null, preset.id)}
                    data-testid={`settings-ai-quick-${preset.id}`}
                  >
                    {preset.name}
                    {preset.recommended && <span className="ml-1 text-[9px] opacity-80">推荐</span>}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="settings-list flex flex-col" data-testid="settings-ai-list">
          {stationConnections.map((connection) => <AiConnectionRow key={connection.id} connection={connection} relayMode={relayMode} />)}
        </div>
      )}

      <div className="mt-5 flex items-start gap-2 pt-1 text-[10.5px] leading-relaxed text-tertiary">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>应用数据的导出、导入和备份都不会携带 AI API Key，也不会在导入后自动测试或替换连接地址。</p>
      </div>
      <AiConnectionDialog />
    </SectionShell>
  );
}

function BoundaryFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-elevated px-3 py-2.5">
      <p className="text-[9.5px] text-tertiary">{label}</p>
      <p className="mt-0.5 text-[10.5px] text-secondary">{value}</p>
    </div>
  );
}

function AiConnectionRow({ connection, relayMode }: { connection: AiConnectionProfile; relayMode: boolean }) {
  const openDialog = useAiConnectionStore((state) => state.openDialog);
  const setActive = useAiConnectionStore((state) => state.setActive);
  const validate = useAiConnectionStore((state) => state.validate);
  const deleteKey = useAiConnectionStore((state) => state.deleteKey);
  const deleteConnection = useAiConnectionStore((state) => state.deleteConnection);
  const test = useAiConnectionStore((state) => state.testStatus[connection.id]);
  const [confirm, setConfirm] = useState<'key' | 'connection' | null>(null);
  const busy = test?.state === 'testing';

  const revoke = async () => {
    try {
      await deleteKey(connection.id);
      setConfirm(null);
      toast.success('API Key 已撤销');
    } catch (error) {
      toast.error('撤销失败', error instanceof Error ? error.message : '请稍后重试');
    }
  };

  const remove = async () => {
    try {
      await deleteConnection(connection.id);
      toast.success('AI 连接已删除');
    } catch (error) {
      toast.error('删除失败', error instanceof Error ? error.message : '请稍后重试');
    }
  };

  return (
    <ConnectionRow
      active={connection.isActive}
      icon={<ModelBrandIcon model={connection.model} className="h-4 w-4" />}
      title={connection.name}
      testId={`settings-ai-row-${connection.id}`}
      meta={
        <>
          <span className="max-w-full truncate">{connection.baseUrl}</span>
          <span className="text-quaternary">·</span>
          <span title={connection.model}>{displayModelName(connection.model)}</span>
          <span className="text-quaternary">·</span>
          <span>{connection.routeKind === 'direct' ? '直连' : '网关'}</span>
          <span className="text-quaternary">·</span>
          {connection.hasKey
            ? <span>{`Key ····${connection.keySuffix}`}</span>
            : <span className="text-warning">缺少 Key</span>}
        </>
      }
      status={
        test?.state === 'failed' ? (
          <p className="mt-2 text-[10.5px] text-danger" role="status">{test.message}</p>
        ) : test?.state === 'success' ? (
          <ConnectionTestSummary connection={connection} message={test.result.message} />
        ) : undefined
      }
      actions={
        <>
          {relayMode && !connection.isActive && (
            <Button size="sm" variant="ghost" onClick={() => void setActive(connection.id)}>
              <Check className="h-3 w-3" /> 设为默认
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => void validate(connection.id)} disabled={!connection.hasKey || busy} data-testid={`settings-ai-test-${connection.id}`}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <KeyRound className="h-3 w-3" />}
            测试连接
          </Button>
          <Button size="sm" variant="ghost" onClick={() => openDialog(connection)}>
            <Pencil className="h-3 w-3" /> 编辑
          </Button>
        </>
      }
      trailing={
        confirm === 'key' ? (
          <InlineConfirm label="确认撤销 Key？" confirmLabel="撤销" onConfirm={() => void revoke()} onCancel={() => setConfirm(null)} />
        ) : confirm === 'connection' ? (
          <InlineConfirm label="确认删除连接？" confirmLabel="删除" danger onConfirm={() => void remove()} onCancel={() => setConfirm(null)} />
        ) : (
          <>
            {connection.hasKey && (
              <Button size="sm" variant="ghost" className="text-tertiary" onClick={() => setConfirm('key')}>
                <Unplug className="h-3 w-3" /> 撤销 Key
              </Button>
            )}
            <Button size="iconSm" variant="ghost" className="text-tertiary hover:text-danger" aria-label={`删除 ${connection.name}`} title="删除连接" onClick={() => setConfirm('connection')}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </>
        )
      }
    />
  );
}

function ConnectionTestSummary({ connection, message }: { connection: AiConnectionProfile; message: string }) {
  const mode = connection.capabilities.preferredStructuredOutputMode;
  return (
    <div className="mt-2 border-t border-border-subtle pt-2 text-[10px]" data-testid={`settings-ai-capabilities-${connection.id}`}>
      <p className="text-success">{message}</p>
      <p className="mt-1 text-tertiary">
        文本可用 · 结构化 {mode === 'json-schema' ? 'Schema 优先' : mode === 'json-object' ? 'Object 优先' : '本地 JSON 校验'} · 不使用流式 · 支持取消
      </p>
    </div>
  );
}
