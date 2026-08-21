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
import {
  Field,
  mergeModelOptions,
  PricingModeButton,
  validatePricingDraft,
  type PricingDraftMode,
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
  const [pricingMode, setPricingMode] = useState<PricingDraftMode>('none');
  const [unitPoints, setUnitPoints] = useState('');
  const [pricingLoadError, setPricingLoadError] = useState<string | null>(null);
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
    setPricingLoadError(null);
    setPricingMode('none');
    setUnitPoints('');
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

  useEffect(() => {
    if (!open || !provider?.id || managed || provider.type === 'doubao-web') return;
    let cancelled = false;
    api.settings.pricing
      .get(provider.id)
      .then((pricing) => {
        if (cancelled) return;
        if (!pricing) {
          setPricingMode('none');
          setUnitPoints('');
          return;
        }
        setPricingMode(pricing.mode);
        setUnitPoints(String(pricing.unitPoints));
      })
      .catch((err) => {
        if (cancelled) return;
        setPricingLoadError((err as Error)?.message || '读取单价配置失败');
      });
    return () => {
      cancelled = true;
    };
  }, [managed, open, provider?.id]);

  function applyPreset(preset: ProviderPreset) {
    setPresetId(preset.id);
    setType(preset.type);
    setName(preset.name);
    setBaseUrl(preset.baseUrl);
    setModel(preset.model);
    setModelOptions([]);
    setModelError(null);
  }

  const pricingError = managed || isDoubaoWeb ? null : validatePricingDraft(pricingMode, unitPoints);
  const valid = managed
    ? Boolean(model.trim())
    : Boolean(name.trim() && baseUrl.trim() && model.trim() && !pricingError);

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
    if (!managed && !isDoubaoWeb && id) {
      if (pricingMode === 'none') {
        await api.settings.pricing.delete(id);
      } else {
        await api.settings.pricing.set({
          providerId: id,
          mode: pricingMode,
          unitPoints: Number(unitPoints),
        });
      }
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
      const models = filterImageModels(listed, { managed, providerType: type });
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
          {/* 预设选择器：Codex 式胶囊行，黑色填充表示当前 */}
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
                      'no-drag rounded-full border px-3 py-1 text-[12px] font-medium transition-colors',
                      active
                        ? 'border-transparent bg-primary text-background'
                        : 'border-border-subtle bg-transparent text-secondary hover:border-border-default hover:text-primary',
                    )}
                  >
                    {p.name}
                    {p.recommended && <span className={cn('ml-1 text-[9.5px]', active ? 'text-background/70' : 'text-quaternary')}>推荐</span>}
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
            </>
          )}
          <Field label={activePreset?.modelLabel ?? '模型'}>
            <div className="flex gap-2">
              <Input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                readOnly={isDoubaoWeb}
                placeholder={activePreset?.model ?? 'gpt-image-2'}
                className={managed ? 'rounded-full px-4 shadow-none' : undefined}
                data-testid="provider-model"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleLoadModels}
                disabled={!valid || loadingModels || testing || saving}
                data-testid="provider-load-models"
                className={managed ? 'rounded-full shadow-none' : undefined}
              >
                {loadingModels ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                拉取
              </Button>
            </div>
            {modelOptions.length > 0 && (
              <div className="mt-2 flex max-h-24 flex-wrap gap-1 overflow-y-auto border-y border-border-subtle py-2" data-testid="provider-model-options">
                {modelOptions.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setModel(item.id)}
                    title={item.description ?? item.id}
                    className={cn(
                      'no-drag rounded-full border px-2.5 py-1 text-[10.5px] transition-colors',
                      displayModelName(item.id) === item.id && 'font-mono',
                      item.id === model
                        ? 'border-transparent bg-primary text-background'
                        : 'border-border-subtle bg-elevated text-secondary hover:border-border-default hover:text-primary',
                    )}
                    data-testid={`provider-model-option-${item.id}`}
                  >
                    {displayModelName(item.id)}
                  </button>
                ))}
              </div>
            )}
            {modelError && (
              <p className="mt-1 text-[11px] text-danger" data-testid="provider-model-error">
                {modelError}
              </p>
            )}
            {activePreset?.modelHint && (
              <p className="mt-1 text-[11px] leading-relaxed text-tertiary">{activePreset.modelHint}</p>
            )}
          </Field>

          {!managed && isDoubaoWeb && (
            <Field label="豆包账号">
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-inset/35 p-3">
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-primary">
                    {keySaved ? '网页会话已连接' : '需要登录豆包网页版'}
                  </p>
                  <p className="mt-0.5 text-[10.5px] leading-relaxed text-tertiary">
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

          {!managed && !isDoubaoWeb && (
            <>
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

          <Field label="计费单价">
            <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-inset/35 p-2.5">
              <div className="flex flex-wrap gap-1" data-testid="provider-pricing-mode">
                <PricingModeButton
                  active={pricingMode === 'none'}
                  onClick={() => setPricingMode('none')}
                  testId="provider-pricing-none"
                >
                  不计价
                </PricingModeButton>
                <PricingModeButton
                  active={pricingMode === 'per-image'}
                  onClick={() => setPricingMode('per-image')}
                  testId="provider-pricing-per-image"
                >
                  每图
                </PricingModeButton>
                <PricingModeButton
                  active={pricingMode === 'per-1k-token'}
                  onClick={() => setPricingMode('per-1k-token')}
                  testId="provider-pricing-per-token"
                >
                  每千 token
                </PricingModeButton>
              </div>
              {pricingMode !== 'none' && (
                <div>
                  <div className="flex items-center gap-2">
                    <Input
                      value={unitPoints}
                      onChange={(e) => setUnitPoints(e.target.value)}
                      placeholder="3.2"
                      inputMode="decimal"
                      className="h-8 w-28 font-mono tabular-nums"
                      data-testid="provider-pricing-unit-points"
                    />
                    <span className="text-[12px] text-tertiary">
                      积分 / {pricingMode === 'per-image' ? '张图' : '千 token'}
                    </span>
                  </div>
                  {pricingError && (
                    <p className="mt-1 text-[11px] text-danger" data-testid="provider-pricing-error">
                      {pricingError}
                    </p>
                  )}
                </div>
              )}
              {pricingMode === 'none' && (
                <p className="text-[11px] leading-relaxed text-tertiary">
                  未配置时成功历史的成本记为空，成本看板会按 0 聚合并保留「未配单价」口径。
                </p>
              )}
              {pricingLoadError && (
                <p className="text-[11px] text-danger" data-testid="provider-pricing-load-error">
                  {pricingLoadError}
                </p>
              )}
            </div>
          </Field>
            </>
          )}

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
          <Button variant="ghost" className={managed ? 'rounded-full shadow-none' : undefined} onClick={() => onOpenChange(false)}>取消</Button>
          <Button variant="outline" className={managed ? 'rounded-full shadow-none' : undefined} onClick={handleTest} disabled={!valid || testing || saving || openingWebLogin} data-testid="provider-test">
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
            {isDoubaoWeb ? '验证登录' : '测试连接'}
          </Button>
          <Button variant="primary" className={managed ? 'rounded-full shadow-none' : undefined} onClick={handleSave} disabled={!valid || saving || testing || openingWebLogin} data-testid="provider-save">
            {saving ? '保存中…' : '保存'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
