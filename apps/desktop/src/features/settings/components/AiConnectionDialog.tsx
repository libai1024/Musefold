import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from '../../../components/ui/icons';
import type {
  AiConnectionPreset,
  AiConnectionRouteKind,
  AiConnectionValidationResult,
  AiTextModelInfo,
} from '@musefold/desktop-contracts/ai';
import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { Input } from '../../../components/ui/input';
import { cn } from '../../../lib/utils';
import api from '../../../lib/ipc';
import { toast } from '../../../stores/toast';
import {
  aiConnectionErrorMessage,
  isAiConnectionRuntimeMismatch,
} from '../ai-connection-errors';
import { useAiConnectionStore } from '../ai-connection-store';

function mergeModels(current: string, models: AiTextModelInfo[]): AiTextModelInfo[] {
  const values = new Map<string, AiTextModelInfo>();
  if (current.trim()) values.set(current.trim(), { id: current.trim(), name: current.trim() });
  for (const model of models) {
    if (model.id.trim()) values.set(model.id.trim(), model);
  }
  return [...values.values()];
}

function reportConnectionError(error: unknown, title: string, fallback: string): string {
  const message = aiConnectionErrorMessage(error, fallback);
  if (isAiConnectionRuntimeMismatch(error)) {
    toast.show({
      title: '需要重启 Musefold',
      description: message,
      variant: 'warning',
      duration: 0,
      action: {
        label: '立即重启',
        onClick: () => { void api.system.relaunch(); },
      },
    });
  } else {
    toast.error(title, message);
  }
  return message;
}

export function AiConnectionDialog() {
  const open = useAiConnectionStore((state) => state.dialogOpen);
  const editing = useAiConnectionStore((state) => state.editingConnection);
  const presets = useAiConnectionStore((state) => state.presets);
  const presetSeed = useAiConnectionStore((state) => state.dialogPresetId);
  const connections = useAiConnectionStore((state) => state.connections);
  const closeDialog = useAiConnectionStore((state) => state.closeDialog);
  const createConnection = useAiConnectionStore((state) => state.createConnection);
  const updateConnection = useAiConnectionStore((state) => state.updateConnection);
  const saveKey = useAiConnectionStore((state) => state.saveKey);
  const deleteKey = useAiConnectionStore((state) => state.deleteKey);
  const listModels = useAiConnectionStore((state) => state.listModels);
  const validate = useAiConnectionStore((state) => state.validate);

  const [presetId, setPresetId] = useState<AiConnectionPreset['id']>('custom');
  const [name, setName] = useState('');
  const [routeKind, setRouteKind] = useState<AiConnectionRouteKind>('direct');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [keySaved, setKeySaved] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [models, setModels] = useState<AiTextModelInfo[]>([]);
  const [modelError, setModelError] = useState<string | null>(null);
  const [result, setResult] = useState<AiConnectionValidationResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [testing, setTesting] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const keyRef = useRef<HTMLInputElement>(null);

  const activePreset = presets.find((preset) => preset.id === presetId);
  const managed = editing?.managedBy === 'account';
  const valid = managed ? Boolean(model.trim()) : Boolean(name.trim() && baseUrl.trim() && model.trim());

  const applyPreset = (preset: AiConnectionPreset) => {
    setPresetId(preset.id);
    setName(preset.name);
    setRouteKind(preset.routeKind);
    setBaseUrl(preset.baseUrl);
    setModel(preset.model);
    setModels([]);
    setModelError(null);
    setResult(null);
  };

  useEffect(() => {
    if (!open) return;
    setApiKey('');
    setShowKey(false);
    setCreatedId(null);
    setModels([]);
    setModelError(null);
    setResult(null);
    setSaving(false);
    setLoadingModels(false);
    setTesting(false);
    setRevoking(false);
    if (editing) {
      setPresetId(editing.presetId);
      setName(editing.name);
      setRouteKind(editing.routeKind);
      setBaseUrl(editing.baseUrl);
      setModel(editing.model);
      setKeySaved(editing.hasKey);
      return;
    }
    const preset = presets.find((item) => item.id === presetSeed) ?? presets[0];
    if (preset) applyPreset(preset);
    else {
      setPresetId('custom');
      setName('我的文本模型');
      setRouteKind('gateway');
      setBaseUrl('https://example.com/v1');
      setModel('model-id');
    }
    setKeySaved(false);
    // applyPreset intentionally resets all dependent fields for each open session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, open, presetSeed, presets]);

  async function persist(): Promise<string> {
    const id = editing?.id ?? createdId;
    const connection = id
      ? await updateConnection(id, managed ? { model } : {
        name,
        routeKind,
        presetId,
        baseUrl,
        model,
      })
      : await createConnection({
        name,
        routeKind,
        presetId,
        baseUrl,
        model,
        protocol: 'openai-compatible',
        isActive: connections.length === 0,
      });
    if (!id) setCreatedId(connection.id);
    if (!managed && apiKey.trim()) {
      await saveKey(connection.id, apiKey);
      setApiKey('');
      setKeySaved(true);
    }
    return connection.id;
  }

  const requireKey = (): boolean => {
    if (keySaved || apiKey.trim()) return true;
    setModelError('先填写 API Key，再刷新模型或测试连接');
    keyRef.current?.focus();
    return false;
  };

  const handleSave = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await persist();
      closeDialog();
      toast.success('AI 连接已保存');
    } catch (error) {
      reportConnectionError(error, '保存失败', '请检查连接信息');
    } finally {
      setSaving(false);
    }
  };

  const handleLoadModels = async () => {
    if (!valid || !requireKey() || loadingModels) return;
    setLoadingModels(true);
    setModelError(null);
    try {
      const id = await persist();
      const discovered = await listModels(id);
      setModels(mergeModels(model, discovered));
      if (discovered.length === 0) setModelError('服务没有返回模型列表，当前手工模型 ID 已保留');
    } catch (error) {
      setModelError(reportConnectionError(error, '模型列表不可用', '可以继续使用手工模型 ID'));
    } finally {
      setLoadingModels(false);
    }
  };

  const handleTest = async () => {
    if (!valid || !requireKey() || testing) return;
    setTesting(true);
    setResult(null);
    setModelError(null);
    try {
      const id = await persist();
      const validation = await validate(id);
      setResult(validation);
      setModels((current) => mergeModels(model, [...current, ...validation.models]));
    } catch (error) {
      const message = reportConnectionError(error, '连接测试失败', '请检查连接信息');
      setResult({
        ok: false,
        message,
        models: [],
        capabilities: editing?.capabilities ?? {
          modelDiscovery: 'unknown',
          supportedStructuredOutputModes: ['json-schema', 'json-object', 'json-text'],
          preferredStructuredOutputMode: 'json-schema',
          cancellation: true,
          streaming: false,
          lastValidatedAt: null,
        },
      });
    } finally {
      setTesting(false);
    }
  };

  const handleRevoke = async () => {
    const id = editing?.id ?? createdId;
    if (!id || revoking) return;
    setRevoking(true);
    try {
      await deleteKey(id);
      setKeySaved(false);
      setResult(null);
      toast.success('API Key 已撤销');
    } catch (error) {
      toast.error('撤销失败', error instanceof Error ? error.message : '请稍后重试');
    } finally {
      setRevoking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) closeDialog(); }}>
      <DialogContent className="max-h-[min(88vh,760px)] max-w-xl overflow-y-auto" data-testid="ai-connection-dialog">
        <DialogHeader>
          <DialogTitle>{managed ? '选择 Agent 模型' : editing ? '编辑 Agent 模型连接' : '添加 Agent 模型连接'}</DialogTitle>
          <DialogDescription>
            {managed
              ? '服务器地址与令牌由账号托管；这里仅切换账号当前可用的 Agent 模型。'
              : '只用于创建和修改设计方案，不会直接生成图片、读取未授权文件或自动发布方案。'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {!managed && (
            <>
          <fieldset>
            <legend className="mb-1.5 text-[11px] font-medium text-secondary">连接预设</legend>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3" data-testid="ai-connection-presets">
              {presets.map((preset) => {
                const selected = preset.id === presetId;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => applyPreset(preset)}
                    className={cn(
                      'min-h-10 rounded-md border px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]',
                      selected
                        ? 'border-transparent bg-primary text-background'
                        : 'border-border-subtle bg-elevated text-secondary hover:border-border-strong hover:bg-hover hover:text-primary',
                    )}
                    data-testid={`ai-preset-${preset.id}`}
                  >
                    <span className="flex items-center gap-1">
                      <span className="min-w-0 truncate text-[11.5px] font-medium">{preset.name}</span>
                      {preset.recommended && (
                        <span className={cn('shrink-0 px-1 py-px text-[8.5px] font-semibold', selected ? 'text-background/70' : 'text-quaternary')}>推荐</span>
                      )}
                    </span>
                    <span className={cn('mt-0.5 block text-[9.5px]', selected ? 'text-background/70' : 'text-tertiary')}>
                      {preset.routeKind === 'direct' ? '厂商直连' : '兼容网关'}
                    </span>
                  </button>
                );
              })}
            </div>
            {activePreset && <p className="mt-1.5 text-[10.5px] leading-relaxed text-tertiary">{activePreset.hint}</p>}
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="连接名称">
              <Input aria-label="连接名称" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：我的 DeepSeek" data-testid="ai-connection-name" />
            </Field>
            <Field label="连接方式">
              <div className="grid grid-cols-2 gap-1 rounded-md border border-border-subtle bg-inset p-1" data-testid="ai-connection-route-kind">
                <RouteButton active={routeKind === 'direct'} onClick={() => setRouteKind('direct')}>厂商直连</RouteButton>
                <RouteButton active={routeKind === 'gateway'} onClick={() => setRouteKind('gateway')}>兼容网关</RouteButton>
              </div>
            </Field>
          </div>

          <Field label="Base URL">
            <Input aria-label="Base URL" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} mono placeholder="https://example.com/v1" data-testid="ai-connection-base-url" />
          </Field>
            </>
          )}

          <Field label="默认模型" hint="模型列表不可用时，可以保留并直接使用手工模型 ID。">
            <div className="flex gap-2">
              <Input aria-label="默认模型" value={model} onChange={(event) => setModel(event.target.value)} mono placeholder="model-id" className={managed ? 'rounded-full px-4 shadow-none' : undefined} data-testid="ai-connection-model" />
              <Button type="button" size="sm" variant="outline" className={managed ? 'rounded-full shadow-none' : undefined} onClick={handleLoadModels} disabled={!valid || loadingModels || testing || saving} data-testid="ai-connection-load-models">
                {loadingModels ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                刷新
              </Button>
            </div>
            {models.length > 0 && (
              <div className="mt-2 max-h-28 overflow-y-auto border-y border-border-subtle py-1" role="listbox" aria-label="可用文本模型" data-testid="ai-connection-model-options">
                {models.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={item.id === model}
                    onClick={() => setModel(item.id)}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 rounded-full px-3 py-1.5 text-left font-mono text-[10.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]',
                      item.id === model ? 'bg-pressed text-primary' : 'text-secondary hover:bg-hover hover:text-primary',
                    )}
                    data-testid={`ai-model-option-${item.id}`}
                  >
                    <span className="truncate">{item.name || item.id}</span>
                    {item.id === model && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                  </button>
                ))}
              </div>
            )}
            {modelError && <p className="mt-1 text-[10.5px] leading-relaxed text-warning" role="status" data-testid="ai-connection-model-error">{modelError}</p>}
          </Field>

          {!managed && (
            <>
          <Field label="API Key">
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Input
                  ref={keyRef}
                  aria-label="API Key"
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={keySaved ? '已保存；输入新值可覆盖' : '输入 API Key'}
                  autoComplete="off"
                  className="pr-9"
                  data-testid="ai-connection-api-key"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((shown) => !shown)}
                  className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-tertiary hover:bg-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                  aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
                >
                  {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
              {keySaved && (
                <Button type="button" size="sm" variant="ghost" className="text-tertiary hover:text-danger" onClick={handleRevoke} disabled={revoking} data-testid="ai-connection-revoke-key">
                  {revoking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unplug className="h-3.5 w-3.5" />}
                  撤销
                </Button>
              )}
            </div>
            <p className="mt-1.5 flex items-start gap-1.5 text-[10.5px] leading-relaxed text-tertiary">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Key 通过系统级加密保存，只在主进程请求模型时解密；页面和导出文件都不会读取它。
            </p>
          </Field>

          <div className="flex items-start gap-2 border-y border-border-subtle py-3 text-[10.5px] leading-relaxed text-tertiary">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>
              费用由你连接的服务商或网关计费。Musefold 不根据模型名称猜测价格；刷新模型或测试连接会先保存当前填写内容。
            </p>
          </div>
            </>
          )}

          {result && <CapabilityResult result={result} />}
        </div>

        <DialogFooter>
          <Button variant="ghost" className={managed ? 'rounded-full shadow-none' : undefined} onClick={closeDialog}>取消</Button>
          <Button variant="outline" className={managed ? 'rounded-full shadow-none' : undefined} onClick={handleTest} disabled={!valid || testing || saving} data-testid="ai-connection-test">
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
            测试连接
          </Button>
          <Button variant="primary" className={managed ? 'rounded-full shadow-none' : undefined} onClick={handleSave} disabled={!valid || saving || testing} data-testid="ai-connection-save">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {saving ? '保存中' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="block">
      <span className="mb-1 block text-[11px] font-medium text-secondary">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10px] leading-relaxed text-tertiary">{hint}</span>}
    </div>
  );
}

function RouteButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'h-7 rounded text-[10.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]',
        active ? 'bg-elevated text-primary' : 'text-tertiary hover:bg-hover hover:text-secondary',
      )}
    >
      {children}
    </button>
  );
}

function CapabilityResult({ result }: { result: AiConnectionValidationResult }) {
  return (
    <div className={cn('rounded-md border px-3 py-2.5', result.ok ? 'border-success/35 bg-success/5' : 'border-danger/35 bg-danger/5')} role="status" data-testid="ai-connection-capabilities">
      <p className={cn('text-[11px] font-medium', result.ok ? 'text-success' : 'text-danger')}>{result.message}</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-5 gap-y-1 text-[10px] sm:grid-cols-4">
        <Capability label="文本请求" value={result.ok ? '可用' : '未通过'} />
        <Capability label="结构化策略" value={result.ok ? outputModeLabel(result.capabilities.preferredStructuredOutputMode) : '未检测'} />
        <Capability label="流式输出" value="本版本不使用" />
        <Capability label="取消请求" value={result.ok && result.capabilities.cancellation ? '支持' : '未检测'} />
      </dl>
    </div>
  );
}

function Capability({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-tertiary">{label}</dt>
      <dd className="mt-0.5 text-secondary">{value}</dd>
    </div>
  );
}

function outputModeLabel(mode: AiConnectionValidationResult['capabilities']['preferredStructuredOutputMode']): string {
  if (mode === 'json-schema') return 'JSON Schema 优先';
  if (mode === 'json-object') return 'JSON Object 优先';
  return '本地 JSON 校验';
}
