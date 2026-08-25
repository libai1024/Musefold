// 生图中转站详情面板(RELAY-SETTINGS-UI 第二步):master-detail 右栏,选中即编辑。
// 字段、校验、doubao-web / managed 分支均沿用 ProviderDialog 语义;
// 草稿态用 product-ui 的 useDraftForm,显式「保存 / 放弃」,不再走弹窗。
// 头部/预设卡片/密钥状态行析出在 provider-detail-parts;
// 底部操作条与分组标题复用 MasterDetail 的 PanelActions / PanelSectionTitle。
import { useMemo, useRef, useState } from 'react';
import type {
  ProviderConfig,
  NewProviderConfig,
  ModelInfo,
} from '@musefold/desktop-contracts/providers';
import type { ErrorAction } from '@musefold/domain/errors';
import { PROVIDER_PRESETS, type ProviderPreset } from '@musefold/domain/constants';
import { pickPreset } from '@musefold/domain/provider-presets';
import { useDraftForm } from '@musefold/product-ui';
import {
  useGenerationStore,
  ValidationResultBanner,
  ProviderField as Field,
  mergeModelOptions,
} from '@renderer/runtime/generation-access';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { ModelOptionList } from '../../../components/ui/model-option-list';
import { Eye, EyeOff, Zap, Loader2, Link2, Trash2 } from '../../../components/ui/icons';
import { displayModelName, filterImageModels } from '../../../lib/model-catalog';
import { InlineConfirm, PanelActions, PanelSectionTitle } from './MasterDetail';
import {
  ApiKeyStatusRow,
  DoubaoWebLoginField,
  ProviderDetailHeader,
  ProviderPresetPicker,
} from './provider-detail-parts';
import { toast } from '../../../stores/toast';
import { desktopHost as api } from '@renderer/runtime/desktop-host-services';

/** 参与 dirty/校验的实体字段；API Key（只写）留在局部状态。 */
interface ProviderDraft {
  presetId: string;
  name: string;
  type: NewProviderConfig['type'];
  baseUrl: string;
  model: string;
}

type ProviderDraftField = 'name' | 'baseUrl' | 'model';

interface Props {
  /** null = 新建草稿(未落库,保存时才创建) */
  provider: ProviderConfig | null;
  /** 新建时预选的接入预设 id(空态一键接入) */
  presetSeed?: string | null;
  /** relay 模式下才允许切换默认 */
  relayMode: boolean;
  onCreated: (id: string) => void;
  onDiscardNew: () => void;
  onDeleted: () => void;
}

export function ProviderDetailPanel({
  provider,
  presetSeed,
  relayMode,
  onCreated,
  onDiscardNew,
  onDeleted,
}: Props) {
  const createProvider = useGenerationStore((s) => s.createProvider);
  const updateProvider = useGenerationStore((s) => s.updateProvider);
  const deleteProvider = useGenerationStore((s) => s.deleteProvider);
  const saveKey = useGenerationStore((s) => s.saveKey);
  const setActive = useGenerationStore((s) => s.setActive);
  const testProvider = useGenerationStore((s) => s.testProvider);
  const listModels = useGenerationStore((s) => s.listModels);
  const activeProviderId = useGenerationStore((s) => s.activeProviderId);
  const providerCount = useGenerationStore((s) => s.providers.length);
  const isFirst = providerCount === 0;

  const managed = provider?.managedBy === 'account';
  const isActive = Boolean(provider && provider.id === activeProviderId);

  const initial = useMemo<ProviderDraft>(() => {
    if (provider) {
      // 匹配预设以高亮(仅作提示;匹配 type,其次 baseUrl)
      const match =
        PROVIDER_PRESETS.find((p) => p.type === provider.type) ??
        PROVIDER_PRESETS.find((p) => p.baseUrl === provider.baseUrl);
      return {
        presetId: match?.id ?? '',
        name: provider.name,
        type: provider.type,
        baseUrl: provider.baseUrl,
        model: provider.model,
      };
    }
    const preset = pickPreset(presetSeed);
    return {
      presetId: preset.id,
      name: preset.name,
      type: preset.type,
      baseUrl: preset.baseUrl,
      model: preset.model,
    };
    // 只随选中条目/预设种子重建草稿,避免无关 store 更新打断编辑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    provider?.id,
    provider?.name,
    provider?.type,
    provider?.baseUrl,
    provider?.model,
    presetSeed,
  ]);

  const form = useDraftForm<ProviderDraft, ProviderDraftField>({
    initial,
    validate: (draft) => {
      if (managed) return draft.model.trim() ? {} : { model: '请选择模型' };
      const errors: Partial<Record<ProviderDraftField, string>> = {};
      if (!draft.name.trim()) errors.name = '请填写名称';
      if (draft.type !== 'doubao-web' && !draft.baseUrl.trim()) errors.baseUrl = '请填写 Base URL';
      if (!draft.model.trim()) errors.model = '请填写模型';
      return errors;
    },
  });
  const draft = form.draft;
  const isDoubaoWeb = draft.type === 'doubao-web';

  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [keySaved, setKeySaved] = useState(provider?.hasKey ?? false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [openingWebLogin, setOpeningWebLogin] = useState(false);
  const [modelOptions, setModelOptions] = useState<ModelInfo[]>([]);
  const [modelError, setModelError] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message?: string; code?: string } | null>(
    null,
  );
  // 新建流程中「测试连接」会先落库创建 provider;记住它的 id,避免随后保存重复创建
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const keyInputRef = useRef<HTMLInputElement>(null);

  const activePreset = PROVIDER_PRESETS.find((p) => p.id === draft.presetId);

  const dirty = form.dirty || apiKey.trim() !== '';
  const valid = form.valid;

  function applyPreset(preset: ProviderPreset) {
    form.setDraft({
      presetId: preset.id,
      name: preset.name,
      type: preset.type,
      baseUrl: preset.baseUrl,
      model: preset.model,
    });
    setModelOptions([]);
    setModelError(null);
  }

  /** 持久化:新建则创建(首个自动设为默认),已有则更新;有新密钥则加密保存。返回 provider id */
  async function persist(): Promise<string | undefined> {
    const existingId = provider?.id ?? createdId ?? undefined;
    let id: string | undefined = existingId;
    if (existingId) {
      await updateProvider(
        existingId,
        managed
          ? { model: draft.model }
          : { name: draft.name, baseUrl: draft.baseUrl, model: draft.model },
      );
    } else {
      const created = await createProvider({
        name: draft.name,
        type: draft.type,
        baseUrl: draft.baseUrl,
        model: draft.model,
        isActive: isFirst,
      });
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
    if (!valid || saving) return;
    setSaving(true);
    try {
      const wasNew = !provider;
      const id = await persist();
      if (wasNew && id) onCreated(id);
      toast.success('服务商已保存');
    } catch (err) {
      // 失败时保留表单,方便改完再存(TASK-GEN-01 异常场景)
      toast.error('保存失败', (err as Error)?.message || '请检查填写项后重试');
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    if (!provider) {
      if (createdId) onCreated(createdId);
      else onDiscardNew();
      return;
    }
    form.reset();
    setApiKey('');
    setShowKey(false);
    setResult(null);
    setModelError(null);
  };

  const handleTest = async () => {
    if (!valid || testing) return;
    setTesting(true);
    setResult(null);
    setModelError(null);
    try {
      // 测试/拉取会先落库创建(沿用弹窗语义),但不切换选中:remount 会丢掉本地
      // 模型列表与测试结果;选中切换只在「保存」时发生(onCreated)。
      const id = await persist();
      if (!id) return;
      // 走 store 的 testProvider:状态点与汇总条随 testStatus 同步
      const test = await testProvider(id);
      setResult({ ok: test.state === 'ok', message: test.message, code: test.code });
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
      // 同 handleTest:落库创建但不切换选中,避免 remount 丢掉刚拉到的模型列表
      const id = await persist();
      if (!id) return;
      const listed = await listModels(id);
      // 生图面板只呈现图像模型;托管站严禁把 Agent 别名混进来
      const models = filterImageModels(listed, { managed });
      const options = mergeModelOptions(draft.model, models);
      setModelOptions(options);
      if (models.length === 1 && models[0].id !== draft.model) form.setField('model', models[0].id);
    } catch (err) {
      setModelError((err as Error)?.message || '模型列表获取失败');
    } finally {
      setLoadingModels(false);
    }
  };

  const handleDelete = async () => {
    if (!provider) return;
    try {
      await deleteProvider(provider.id);
      onDeleted();
    } catch (err) {
      toast.error('删除失败', (err as Error)?.message || '请稍后重试');
    }
  };

  /** 错误分类引导动作(TASK-GEN-03) */
  const handleValidationAction = (action: ErrorAction) => {
    switch (action.kind) {
      case 'update_key':
        if (isDoubaoWeb) {
          void handleOpenWebLogin();
          break;
        }
        setShowKey(true);
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
      default:
        break;
    }
  };

  return (
    <div className="settings-detail-root" data-testid="settings-provider-detail">
      {/* 头部:名称 + 设为默认/默认徽标(本体在 provider-detail-parts;删除下沉到底部操作条) */}
      <ProviderDetailHeader
        title={provider ? provider.name : '新建服务商'}
        isActive={isActive}
        showSetDefault={Boolean(provider && relayMode && !isActive)}
        onSetDefault={() => provider && void setActive(provider.id)}
      />

      <div className="settings-detail-form">
        {/* 预设选择(仅新建态) */}
        {!provider && !managed && (
          <ProviderPresetPicker presetId={draft.presetId} onPick={applyPreset} />
        )}

        {!managed && (
          <>
            {/* 连接分组:名称 / Base URL / API Key(或豆包登录) */}
            <div className="settings-detail-section">
              <PanelSectionTitle title="连接" testId="provider-section-connection" />
              <Field label="名称">
                <Input
                  aria-label="名称"
                  value={draft.name}
                  onChange={(e) => form.setField('name', e.target.value)}
                  placeholder="如:我的中转站"
                  data-testid="provider-name"
                />
              </Field>
              {!isDoubaoWeb && (
                <Field label="Base URL">
                  <Input
                    aria-label="Base URL"
                    value={draft.baseUrl}
                    onChange={(e) => form.setField('baseUrl', e.target.value)}
                    placeholder="https://ai.tvt.wiki/v1"
                    data-testid="provider-base-url"
                  />
                </Field>
              )}

              {isDoubaoWeb && (
                <DoubaoWebLoginField
                  keySaved={keySaved}
                  openingWebLogin={openingWebLogin}
                  busy={testing || saving}
                  onOpen={() => void handleOpenWebLogin()}
                />
              )}

              {!isDoubaoWeb && (
                <Field label="API Key">
                  {keySaved && <ApiKeyStatusRow keySuffix={provider?.keySuffix ?? undefined} />}
                  <div className="relative">
                    <Input
                      ref={keyInputRef}
                      aria-label="API Key"
                      type={showKey ? 'text' : 'password'}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder={keySaved ? '已保存(输入新值可覆盖)' : 'sk-...'}
                      className="pr-9"
                      data-testid="provider-api-key"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((s) => !s)}
                      className="no-drag absolute right-2 top-1/2 -translate-y-1/2 text-tertiary hover:text-secondary"
                      aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
                      title={showKey ? '隐藏 API Key' : '显示 API Key'}
                    >
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {activePreset?.keyUrl && !keySaved && (
                    <p className="mt-1 flex items-center gap-1 font-mono text-[11px] text-tertiary">
                      <Link2 className="h-3 w-3 shrink-0" /> {activePreset.keyUrl}
                    </p>
                  )}
                </Field>
              )}
            </div>
          </>
        )}

        {/* 模型分组:输入即添加手工模型,拉取结果呈行式列表 */}
        <div
          className={
            managed
              ? 'settings-detail-section'
              : 'settings-detail-section settings-detail-section--divider'
          }
        >
          <PanelSectionTitle
            title="模型"
            value={modelOptions.length > 0 ? `${modelOptions.length} 个可用模型` : undefined}
            testId="provider-section-model"
          />
          <Field label={activePreset?.modelLabel ?? '模型'}>
            <Input
              aria-label={activePreset?.modelLabel ?? '模型'}
              value={draft.model}
              onChange={(e) => form.setField('model', e.target.value)}
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
                selectedId={draft.model}
                onSelect={(id) => form.setField('model', id)}
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
                {loadingModels ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Zap className="h-3.5 w-3.5" />
                )}
                拉取
              </Button>
            </div>
            {modelError && (
              <p className="mt-1 text-[11px] text-danger" data-testid="provider-model-error">
                {modelError}
              </p>
            )}
            {activePreset?.modelHint && (
              <p className="mt-1 text-[11px] leading-relaxed text-tertiary">
                {activePreset.modelHint}
              </p>
            )}
          </Field>
        </div>

        {result && (
          <ValidationResultBanner
            result={{
              ok: result.ok,
              message: result.message,
              code: result.code,
              modelCount: result.ok ? modelOptions.length || undefined : undefined,
            }}
            docsUrl={activePreset?.keyUrl}
            onAction={handleValidationAction}
          />
        )}
      </div>

      {/* 底部操作条(sticky):左端删除(行内二次确认),右端 dirty 圆点 + 放弃 / 测试连接 / 保存 */}
      <PanelActions
        dirty={dirty}
        danger={
          provider && !managed ? (
            confirmDelete ? (
              <InlineConfirm
                label="确认删除?"
                confirmLabel="删除"
                danger
                onConfirm={() => void handleDelete()}
                onCancel={() => setConfirmDelete(false)}
              />
            ) : (
              <Button
                size="iconSm"
                variant="ghost"
                className="text-tertiary hover:text-danger"
                aria-label={`删除 ${provider.name}`}
                title="删除服务商"
                onClick={() => setConfirmDelete(true)}
                data-testid="provider-delete"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )
          ) : undefined
        }
        onDiscard={handleDiscard}
        discardLabel={!provider && !createdId ? '取消' : '放弃'}
        discardDisabled={!dirty && Boolean(provider)}
        onTest={handleTest}
        testLabel={isDoubaoWeb ? '验证登录' : '测试连接'}
        testIcon={<Zap className="h-3.5 w-3.5" />}
        testBusy={testing}
        testDisabled={!valid || testing || saving || openingWebLogin}
        testTestId="provider-test"
        onSave={handleSave}
        saveLabel={saving ? '保存中…' : '保存'}
        saveDisabled={!valid || saving || testing || openingWebLogin}
        saveTestId="provider-save"
      />
    </div>
  );
}
