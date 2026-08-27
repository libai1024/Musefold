// 生图中转站详情面板(RELAY-SETTINGS-UI 第二步):master-detail 右栏,选中即编辑。
// 草稿态用 product-ui 的 useDraftForm,显式「保存 / 放弃」,不再走弹窗。
// 面板入口(ProvidersSection)已过滤 managedBy==='account' 与 type==='doubao-web',
// 两条历史分支在本面板不可达、已移除(完整语义仍由 generation 的 ProviderDialog 承载)。
// 草稿表单在 provider-detail-hooks;头部/预设卡片/连接分组在 provider-detail-parts;
// 模型分组在 provider-detail-models;底部操作条复用 MasterDetail 的 PanelActions。
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ProviderConfig, ModelInfo } from '@musefold/desktop-contracts/providers';
import type { ErrorAction } from '@musefold/domain/errors';
import { PROVIDER_PRESETS, type ProviderPreset } from '@musefold/domain/constants';
import {
  useGenerationStore,
  ValidationResultBanner,
  mergeModelOptions,
} from '@renderer/runtime/generation-access';
import { Button } from '../../../components/ui/button';
import { Zap, Trash2 } from '../../../components/ui/icons';
import { filterImageModels } from '../../../lib/model-catalog';
import { InlineConfirm, PanelActions } from './MasterDetail';
import {
  ProviderDetailHeader,
  ProviderPresetPicker,
  ProviderConnectionSection,
} from './provider-detail-parts';
import { ProviderDetailModels } from './provider-detail-models';
import { PROVIDER_DRAFT_FIELDS, useProviderDraftForm } from './provider-detail-hooks';
import { toast } from '../../../stores/toast';

interface Props {
  /** null = 新建草稿(未落库,保存时才创建) */
  provider: ProviderConfig | null;
  /** 新建时预选的接入预设 id(空态一键接入) */
  presetSeed?: string | null;
  /** relay 模式下才允许切换默认 */
  relayMode: boolean;
  /** dirty 上抛:section 层用于切换左栏条目/relay tab 时的拦截确认 */
  onDirtyChange?: (dirty: boolean) => void;
  /** 切换守卫确认条(section 注入;存在时替换底部操作按钮组) */
  dirtyGuard?: ReactNode;
  onCreated: (id: string) => void;
  onDiscardNew: () => void;
  onDeleted: () => void;
}

export function ProviderDetailPanel({
  provider,
  presetSeed,
  relayMode,
  onDirtyChange,
  dirtyGuard,
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

  const isActive = Boolean(provider && provider.id === activeProviderId);

  const form = useProviderDraftForm(provider, presetSeed);
  const draft = form.draft;

  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [keySaved, setKeySaved] = useState(provider?.hasKey ?? false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelOptions, setModelOptions] = useState<ModelInfo[]>([]);
  const [modelError, setModelError] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message?: string; code?: string } | null>(
    null,
  );
  // 新建流程中「测试连接/拉取」会先落库创建 provider;记住它的 id,避免随后保存重复创建
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const keyInputRef = useRef<HTMLInputElement>(null);

  const activePreset = PROVIDER_PRESETS.find((p) => p.id === draft.presetId);

  const dirty = form.dirty || apiKey.trim() !== '';
  const valid = form.valid;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  /** 拉取模型只依赖名称 + Base URL(模型可留空,拉到列表后再选);保存仍要求完整必填 */
  const loadModelsReady = !form.errors.name && !form.errors.baseUrl;

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
      await updateProvider(existingId, {
        name: draft.name,
        baseUrl: draft.baseUrl,
        model: draft.model,
      });
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
    if (apiKey && id) {
      await saveKey(id, apiKey);
      setKeySaved(true);
      setApiKey('');
    }
    return id;
  }

  const handleSave = async () => {
    if (saving) return;
    // 缺必填时保存按钮可点:点一下点亮全部字段错误,而不是静默置灰
    if (!valid) {
      form.touchAll(PROVIDER_DRAFT_FIELDS);
      return;
    }
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
      // 新建草稿已被测试/拉取隐式落库:按钮此时为「完成」,保留并选中该条目
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

  /** 测试/拉取前置:无已存 Key 且未填新 Key 时,提示并聚焦密钥框(与 Agent 面板对称)。 */
  const requireKey = (): boolean => {
    if (keySaved || apiKey.trim()) return true;
    setModelError('先填写 API Key,再拉取模型或测试连接');
    keyInputRef.current?.focus();
    return false;
  };

  const handleTest = async () => {
    if (!valid || !requireKey() || testing) return;
    setTesting(true);
    setResult(null);
    setModelError(null);
    try {
      // 测试/拉取会先落库创建(沿用弹窗语义),但不切换选中:remount 会丢掉本地
      // 模型列表与测试结果;选中切换只在「保存/完成」时发生(onCreated)。
      const wasImplicitCreate = !provider && !createdId;
      const id = await persist();
      // 落库内容即当前表单值:重置 dirty 基线,后续修改才算未保存。
      form.markPristine();
      if (wasImplicitCreate && id) toast.success('服务商已创建');
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

  const handleLoadModels = async () => {
    if (!loadModelsReady || !requireKey() || loadingModels || testing || saving) return;
    setLoadingModels(true);
    setModelError(null);
    try {
      // 同 handleTest:落库创建但不切换选中,避免 remount 丢掉刚拉到的模型列表
      const wasImplicitCreate = !provider && !createdId;
      const id = await persist();
      form.markPristine();
      if (wasImplicitCreate && id) toast.success('服务商已创建');
      if (!id) return;
      const listed = await listModels(id);
      // 生图面板只呈现图像模型(托管分支已移除,managed 恒为 false)
      const models = filterImageModels(listed, { managed: false });
      const options = mergeModelOptions(draft.model, models);
      setModelOptions(options);
      // 单模型自动选中;模型留空时(拉取不要求模型必填)自动选首个可用模型
      if (
        models.length > 0 &&
        (!draft.model.trim() || (models.length === 1 && models[0].id !== draft.model))
      ) {
        form.setField('model', models[0].id);
      }
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
        {!provider && <ProviderPresetPicker presetId={draft.presetId} onPick={applyPreset} />}

        {/* 连接分组:名称 / Base URL / API Key(本体在 provider-detail-parts) */}
        <ProviderConnectionSection
          name={draft.name}
          baseUrl={draft.baseUrl}
          onNameChange={(value) => form.setField('name', value)}
          onBaseUrlChange={(value) => form.setField('baseUrl', value)}
          onNameTouch={() => form.markTouched('name')}
          onBaseUrlTouch={() => form.markTouched('baseUrl')}
          nameError={form.errorFor('name')}
          baseUrlError={form.errorFor('baseUrl')}
          keySaved={keySaved}
          keySuffix={provider?.keySuffix ?? undefined}
          apiKey={apiKey}
          onApiKeyChange={setApiKey}
          showKey={showKey}
          onToggleShowKey={() => setShowKey((s) => !s)}
          keyInputRef={keyInputRef}
          keyUrl={activePreset?.keyUrl}
        />

        {/* 模型分组:输入即添加手工模型,拉取结果呈行式列表(本体在 provider-detail-models) */}
        <ProviderDetailModels
          model={draft.model}
          onModelChange={(value) => form.setField('model', value)}
          onModelTouch={() => form.markTouched('model')}
          error={form.errorFor('model')}
          modelOptions={modelOptions}
          onLoadModels={handleLoadModels}
          loadDisabled={!loadModelsReady || testing || saving}
          loadingModels={loadingModels}
          modelError={modelError}
          modelLabel={activePreset?.modelLabel ?? '模型'}
          modelPlaceholder={activePreset?.model ?? 'gpt-image-2'}
          modelHint={activePreset?.modelHint}
        />

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
        guard={dirtyGuard}
        danger={
          provider ? (
            confirmDelete ? (
              <InlineConfirm
                label="确认删除此服务商?"
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
        discardLabel={!provider ? (createdId ? (dirty ? '放弃' : '完成') : '取消') : '放弃'}
        discardDisabled={!dirty && Boolean(provider)}
        onTest={handleTest}
        testLabel="测试连接"
        testIcon={<Zap className="h-3.5 w-3.5" />}
        testBusy={testing}
        testDisabled={!valid || testing || saving}
        testTestId="provider-test"
        onSave={handleSave}
        saveLabel={saving ? '保存中…' : '保存'}
        saveDisabled={testing || saving}
        saveTestId="provider-save"
      />
    </div>
  );
}
