// src/features/generation/components/ProviderDialog.tsx
// Provider 配置对话框 —— API Key 服务商或持久网页会话 + 内联测试连接
// 详见 docs/05-image-generation.md §4

import { useEffect, useRef, useState } from 'react';
import type {
  ProviderConfig,
  NewProviderConfig,
} from '@musefold/desktop-contracts/providers';
import type { ModelInfo, ValidationResult } from '@musefold/desktop-contracts/providers';
import type { ErrorAction } from '@musefold/domain/errors';
import {
  PROVIDER_PRESETS,
  type ProviderPreset,
} from '@musefold/domain/constants';
import { pickPreset } from '@musefold/domain/provider-presets';
import { useGenerationStore } from '../store';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../../components/ui/dialog';
import { Eye, EyeOff, Check, AlertCircle, Zap, Loader2, Link2, ExternalLink } from '../../../components/ui/icons';
import { cn } from '../../../lib/utils';
import { displayModelName, filterImageModels } from '../../../lib/model-catalog';
import { ValidationResultBanner } from './ValidationResultBanner';
import { ModelOptionList } from '../../../components/ui/model-option-list';
import {
  Field,
  mergeModelOptions,
} from './provider-dialog-parts';
import { toast } from '../../../stores/toast';
import { desktopHost as api } from '@renderer/runtime/desktop-host-services';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider?: ProviderConfig | null;
}

export function ProviderDialog({ open, onOpenChange, provider }: Props) {
  const { createProvider, updateProvider, saveKey, validate, listModels, loadProviders } = useGenerationStore();
  const providerCount = useGenerationStore((s) => s.providers.length);
  const dialogPresetId = useGenerationStore((s) => s.dialogPresetId);
  const dialogDraft = useGenerationStore((s) => s.dialogDraft);
  const isFirst = providerCount === 0;

  const [presetId, setPresetId] = useState<string>(() => pickPreset().id);
  const [name, setName] = useState('');
  const [type, setType] = useState<NewProviderConfig['type']>('openai-compatible');
  const [baseUrl, setBaseUrl] = useState('https://ai.tvt.wiki/v1');
  const [model, setModel] = useState('gpt-image-2');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [keySaved, setKeySaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [openingWebLogin, setOpeningWebLogin] = useState(false);
  const [modelOptions, setModelOptions] = useState<ModelInfo[]>([]);
  const [modelError, setModelError] = useState<string | null>(null);
  const [result, setResult] = useState<ValidationResult | null>(null);
  // 新建流程中，「测试连接」会先落库创建 provider；记住它的 id，避免随后「保存」
  // （或再次测试）再次 createProvider 产生重复条目。
  const [createdId, setCreatedId] = useState<string | null>(null);
  const keyInputRef = useRef<HTMLInputElement>(null);

  const activePreset = PROVIDER_PRESETS.find((p) => p.id === presetId);
  const managed = provider?.managedBy === 'account';
  const isDoubaoWeb = type === 'doubao-web';

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setShowKey(false);
    setCreatedId(null);
    setModelOptions([]);
    setModelError(null);
    setOpeningWebLogin(false);
    if (provider) {
      setName(provider.name);
      setType(provider.type);
      setBaseUrl(provider.baseUrl);
      setModel(provider.model);
      setKeySaved(provider.hasKey);
      setApiKey('');
      // 匹配预设以高亮（编辑时仅作提示；匹配 type，其次 baseUrl）
      const match =
        PROVIDER_PRESETS.find((p) => p.type === provider.type) ??
        PROVIDER_PRESETS.find((p) => p.baseUrl === provider.baseUrl);
      setPresetId(match?.id ?? '');
    } else {
      // 空态一键接入可指定 preset；否则用默认推荐（TvT）
      const preset = pickPreset(dialogPresetId);
      applyPreset(preset);
      if (dialogDraft?.name) setName(dialogDraft.name);
      if (dialogDraft?.type) setType(dialogDraft.type);
      if (dialogDraft?.baseUrl) setBaseUrl(dialogDraft.baseUrl);
      if (dialogDraft?.model) setModel(dialogDraft.model);
      setApiKey('');
      setKeySaved(false);
      requestAnimationFrame(() => keyInputRef.current?.focus());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, open, dialogPresetId, dialogDraft]);

  function applyPreset(preset: ProviderPreset) {
    setPresetId(preset.id);
    setType(preset.type);
    setName(preset.name);
    setBaseUrl(preset.baseUrl);
    setModel(preset.model);
    setModelOptions([]);
    setModelError(null);
  }

  const valid = managed
    ? Boolean(model.trim())
    : Boolean(name.trim() && baseUrl.trim() && model.trim());

  /** 持久化：新建则创建（首个自动设为默认），已有则更新；有新密钥则加密保存。返回 provider id */
  async function persist(): Promise<string | undefined> {
    // 已存在的目标 id：编辑态用 prop，新建态用本次会话已创建的 id（测试连接时落的库）
    const existingId = provider?.id ?? createdId ?? undefined;
    let id: string | undefined = existingId;
    if (existingId) {
      await updateProvider(existingId, managed ? { model } : { name, baseUrl, model });
    } else {
      const created = await createProvider({ name, type, baseUrl, model, isActive: isFirst });
      id = created.id;
      setCreatedId(created.id);
    }
    if (!managed && !isDoubaoWeb && apiKey && id) {
      await saveKey(id, apiKey);
      setKeySaved(true);
      setApiKey('');
    }
    return id;
  }

  const handleSave = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await persist();
      onOpenChange(false);
    } catch (err) {
      // 失败时保留表单，方便改完再存（TASK-GEN-01 异常场景）
      toast.error('保存失败', (err as Error)?.message || '请检查填写项后重试');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!valid) return;
    setTesting(true);
    setResult(null);
    setModelError(null);
    try {
      const id = await persist();
      if (!id) return;
      const validation = await validate(id);
      setResult(validation);
      if (isDoubaoWeb) {
        setKeySaved(validation.ok);
        await loadProviders();
      }
      if (validation.models?.length) setModelOptions(mergeModelOptions(model, validation.models));
    } catch (err) {
      setResult({ ok: false, code: 'UNKNOWN', message: (err as Error).message || '连接失败' });
    } finally {
      setTesting(false);
    }
  };

  const handleOpenWebLogin = async () => {
    if (openingWebLogin) return;
    setOpeningWebLogin(true);
    setResult(null);
    try {
      await api.provider.openWebLogin();
    } catch (error) {
      setResult({
        ok: false,
        code: 'UNKNOWN',
        message: error instanceof Error ? error.message : '无法打开豆包登录窗口',
      });
    } finally {
      setOpeningWebLogin(false);
    }
  };

  const handleLoadModels = async () => {
    if (!valid || loadingModels || testing || saving) return;
    setLoadingModels(true);
    setModelError(null);
    try {
      const id = await persist();
      if (!id) return;
      const listed = await listModels(id);
      // 生图对话框只呈现图像模型；托管站严禁把 Agent 别名混进来。
      const models = filterImageModels(listed, { managed });
      const options = mergeModelOptions(model, models);
      setModelOptions(options);
      if (models.length === 1 && models[0].id !== model) setModel(models[0].id);
    } catch (err) {
      setModelError((err as Error)?.message || '模型列表获取失败');
    } finally {
      setLoadingModels(false);
    }
  };

  /** 错误分类引导动作（TASK-GEN-03） */
  const handleValidationAction = (action: ErrorAction) => {
    switch (action.kind) {
      case 'update_key':
        if (isDoubaoWeb) {
          void handleOpenWebLogin();
          break;
        }
        setShowKey(true);
        // 下一帧聚焦，确保 showKey 切换后 input 仍在
        requestAnimationFrame(() => {
          keyInputRef.current?.focus();
          keyInputRef.current?.select();
        });
        break;
      case 'open_url':
        if (activePreset?.keyUrl) {
          window.open(activePreset.keyUrl, '_blank', 'noopener,noreferrer');
        }
        break;
      case 'retry':
        void handleTest();
        break;
      case 'check_model':
        // 模型字段是第二个/第三个输入；用 query 找 model 输入不稳，直接滚动到顶部提示
        break;
      default:
        break;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{managed ? '选择生图模型' : provider ? '编辑服务商' : isFirst ? '添加第一个服务商' : '新建服务商'}</DialogTitle>
          <DialogDescription>
            {managed
              ? '服务器地址与令牌由账号托管；这里仅切换账号当前可用的生图模型。'
              : isDoubaoWeb
              ? '使用本机独立浏览器会话登录豆包；登录信息不会进入 Musefold 数据库。'
              : isFirst
              ? '选一个预设自动填好接入信息，只需粘贴 API Key 即可开始生图。'
              : '选择预设一键填好接入信息，或自定义 base_url 与模型。'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3.5">
          {!managed && (
            <>
          {/* 预设选择器：6px 圆角行，黑色填充表示当前 */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium text-secondary">接入预设</label>
            <div className="flex flex-wrap gap-1.5">
              {PROVIDER_PRESETS.filter((p) => p.type !== 'doubao-web').map((p) => {
                const active = p.id === presetId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => applyPreset(p)}
                    data-active={active ? 'true' : 'false'}
                    className={cn(
                      'no-drag rounded-sm border px-3 py-1 text-[12px] font-medium transition-colors',
                      active
                        ? 'border-transparent bg-primary text-background'
                        : 'border-border-subtle bg-transparent text-secondary hover:border-border-default hover:text-primary',
                    )}
                  >
                    {p.name}
                    {p.recommended && <span className={cn('ml-1 text-meta', active ? 'text-background/70' : 'text-quaternary')}>推荐</span>}
                  </button>
                );
              })}
            </div>
            {activePreset?.hint && (
              <p className="mt-1.5 text-[11px] leading-relaxed text-tertiary">{activePreset.hint}</p>
            )}
          </div>

          <Field label="名称">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如：我的中转站"
              data-testid="provider-name"
            />
          </Field>
          {!isDoubaoWeb && <Field label="Base URL">
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://ai.tvt.wiki/v1"
              data-testid="provider-base-url"
            />
          </Field>}

          {isDoubaoWeb && (
            <Field label="豆包账号">
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-inset/35 p-3">
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-primary">
                    {keySaved ? '网页会话已连接' : '需要登录豆包网页版'}
                  </p>
                  <p className="mt-0.5 text-meta leading-relaxed text-tertiary">
                    登录状态保存在本机专用浏览器会话中；验证码和安全验证始终由你手动完成。
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleOpenWebLogin}
                  disabled={openingWebLogin || testing || saving}
                  data-testid="provider-open-web-login"
                  className="shrink-0"
                >
                  {openingWebLogin ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
                  {keySaved ? '重新登录' : '打开登录'}
                </Button>
              </div>
              <p className="mt-1.5 flex items-start gap-1 text-[11px] leading-relaxed text-tertiary">
                <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                此接入依赖豆包网页结构，属于实验功能；出现验证或结构变化时会停止自动化并显示豆包窗口。
              </p>
            </Field>
          )}

          {!isDoubaoWeb && (
          <Field label="API Key">
            <div className="relative">
              <Input
                ref={keyInputRef}
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={keySaved ? '已保存（输入新值可覆盖）' : 'sk-...'}
                className="pr-9"
                data-testid="provider-api-key"
              />
              <button
                onClick={() => setShowKey((s) => !s)}
                className="no-drag absolute right-2 top-1/2 -translate-y-1/2 text-tertiary hover:text-secondary"
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {keySaved && (
              <p className="mt-1 flex items-center gap-1 text-[11px] text-success">
                <Check className="h-3 w-3" /> 密钥已加密保存
                {provider?.keySuffix ? `（····${provider.keySuffix}）` : ''}
              </p>
            )}
            {activePreset?.keyUrl && !keySaved && (
              <p className="mt-1 flex items-center gap-1 font-mono text-[11px] text-tertiary">
                <Link2 className="h-3 w-3 shrink-0" /> {activePreset.keyUrl}
              </p>
            )}
            <p className="mt-1.5 flex items-start gap-1 text-[11px] leading-relaxed text-tertiary">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              密钥通过系统级加密（Keychain / DPAPI）保存，仅主进程可解密，永不暴露给渲染进程或日志。
            </p>
          </Field>
          )}
            </>
          )}

          {/* 模型分组：输入即添加手工模型，拉取结果呈行式列表 */}
          <div className={managed ? undefined : 'border-t border-border-subtle pt-3.5'}>
          <Field label={activePreset?.modelLabel ?? '模型'}>
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              readOnly={isDoubaoWeb}
              placeholder={activePreset?.model ?? 'gpt-image-2'}
              data-testid="provider-model"
            />
            {modelOptions.length > 0 && (
              <ModelOptionList
                items={modelOptions.map((item) => ({
                  id: item.id,
                  label: displayModelName(item.id),
                  title: item.description ?? item.id,
                  mono: displayModelName(item.id) === item.id,
                }))}
                selectedId={model}
                onSelect={setModel}
                ariaLabel="可用生图模型"
                testId="provider-model-options"
                optionTestId={(id) => `provider-model-option-${id}`}
              />
            )}
            <div className="mt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleLoadModels}
                disabled={!valid || loadingModels || testing || saving}
                data-testid="provider-load-models"
              >
                {loadingModels ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                拉取
              </Button>
            </div>
            {modelError && (
              <p className="mt-1 text-[11px] text-danger" data-testid="provider-model-error">
                {modelError}
              </p>
            )}
            {activePreset?.modelHint && (
              <p className="mt-1 text-[11px] leading-relaxed text-tertiary">{activePreset.modelHint}</p>
            )}
          </Field>
          </div>

          {result && (
            <ValidationResultBanner
              result={{
                ok: result.ok,
                message: result.message,
                code: result.code,
                modelCount: result.models?.length,
              }}
              docsUrl={activePreset?.keyUrl}
              onAction={handleValidationAction}
            />
          )}
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" className={managed ? 'shadow-none' : undefined} onClick={() => onOpenChange(false)}>取消</Button>
          <Button variant="outline" className={managed ? 'shadow-none' : undefined} onClick={handleTest} disabled={!valid || testing || saving || openingWebLogin} data-testid="provider-test">
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
            {isDoubaoWeb ? '验证登录' : '测试连接'}
          </Button>
          <Button variant="primary" className={managed ? 'shadow-none' : undefined} onClick={handleSave} disabled={!valid || saving || testing || openingWebLogin} data-testid="provider-save">
            {saving ? '保存中…' : '保存'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
