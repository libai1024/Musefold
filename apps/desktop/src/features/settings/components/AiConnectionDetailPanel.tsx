// src/features/settings/components/AiConnectionDetailPanel.tsx
// Agent 中转站详情面板(RELAY-SETTINGS-UI 第二步):master-detail 右栏,选中即编辑。
// 字段、校验、routeKind 分段、撤销 Key、CapabilityResult 测试面板均沿用 AiConnectionDialog 语义;
// 草稿态用 product-ui 的 useDraftForm,显式「保存 / 放弃」,不再走弹窗。
// 预设网格在 AiConnectionDialogParts.tsx,纯函数在 ai-connection-panel-utils.ts;
// 底部操作条与分组标题复用 MasterDetail 的 PanelActions / PanelSectionTitle(与生图面板同构)。

import { useMemo, useRef, useState } from 'react';
import {
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  RefreshCw,
  Trash2,
  Unplug,
} from '../../../components/ui/icons';
import type {
  AiConnectionPreset,
  AiConnectionProfile,
  AiConnectionRouteKind,
  AiConnectionValidationResult,
  AiTextModelInfo,
} from '@musefold/desktop-contracts/ai';
import { useDraftForm } from '@musefold/product-ui';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { ModelOptionList } from '../../../components/ui/model-option-list';
import { toast } from '../../../stores/toast';
import { useAiConnectionStore } from '../ai-connection-store';
import {
  CapabilityResult,
  AiConnectionPresetGrid,
  Field,
  RouteButton,
} from './AiConnectionDialogParts';
import { InlineConfirm, PanelActions, PanelSectionTitle } from './MasterDetail';
import {
  FALLBACK_CAPABILITIES,
  mergeModels,
  reportConnectionError,
} from './ai-connection-panel-utils';

/** 参与 dirty/校验的实体字段;API Key(只写)留在局部状态 */
interface AiConnectionDraft {
  presetId: AiConnectionPreset['id'];
  name: string;
  routeKind: AiConnectionRouteKind;
  baseUrl: string;
  model: string;
}

type AiConnectionDraftField = 'name' | 'baseUrl' | 'model';

interface Props {
  /** null = 新建草稿(未落库,保存/测试/刷新时才创建) */
  connection: AiConnectionProfile | null;
  /** 新建时预选的连接预设 id(空态快捷入口) */
  presetSeed?: AiConnectionPreset['id'] | null;
  /** relay 模式下才允许切换默认 */
  relayMode: boolean;
  onCreated: (id: string) => void;
  onDiscardNew: () => void;
  onDeleted: () => void;
}

export function AiConnectionDetailPanel({
  connection,
  presetSeed,
  relayMode,
  onCreated,
  onDiscardNew,
  onDeleted,
}: Props) {
  const presets = useAiConnectionStore((state) => state.presets);
  const connections = useAiConnectionStore((state) => state.connections);
  const createConnection = useAiConnectionStore((state) => state.createConnection);
  const updateConnection = useAiConnectionStore((state) => state.updateConnection);
  const deleteConnection = useAiConnectionStore((state) => state.deleteConnection);
  const saveKey = useAiConnectionStore((state) => state.saveKey);
  const deleteKey = useAiConnectionStore((state) => state.deleteKey);
  const setActive = useAiConnectionStore((state) => state.setActive);
  const listModels = useAiConnectionStore((state) => state.listModels);
  const validate = useAiConnectionStore((state) => state.validate);

  const managed = connection?.managedBy === 'account';

  const initial = useMemo<AiConnectionDraft>(() => {
    if (connection) {
      return {
        presetId: connection.presetId,
        name: connection.name,
        routeKind: connection.routeKind,
        baseUrl: connection.baseUrl,
        model: connection.model,
      };
    }
    const preset = presets.find((item) => item.id === presetSeed) ?? presets[0];
    if (preset) {
      return {
        presetId: preset.id,
        name: preset.name,
        routeKind: preset.routeKind,
        baseUrl: preset.baseUrl,
        model: preset.model,
      };
    }
    return {
      presetId: 'custom',
      name: '我的文本模型',
      routeKind: 'gateway',
      baseUrl: 'https://example.com/v1',
      model: 'model-id',
    };
    // 只随选中条目/预设种子重建草稿,避免无关 store 更新打断编辑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    connection?.id,
    connection?.presetId,
    connection?.name,
    connection?.routeKind,
    connection?.baseUrl,
    connection?.model,
    presetSeed,
    presets,
  ]);

  const form = useDraftForm<AiConnectionDraft, AiConnectionDraftField>({
    initial,
    validate: (draft) => {
      if (managed) return draft.model.trim() ? {} : { model: '请选择模型' };
      const errors: Partial<Record<AiConnectionDraftField, string>> = {};
      if (!draft.name.trim()) errors.name = '请填写连接名称';
      if (!draft.baseUrl.trim()) errors.baseUrl = '请填写 Base URL';
      if (!draft.model.trim()) errors.model = '请填写默认模型';
      return errors;
    },
  });
  const draft = form.draft;

  const [apiKey, setApiKey] = useState('');
  const [keySaved, setKeySaved] = useState(connection?.hasKey ?? false);
  const [showKey, setShowKey] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [models, setModels] = useState<AiTextModelInfo[]>([]);
  const [modelError, setModelError] = useState<string | null>(null);
  const [result, setResult] = useState<AiConnectionValidationResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [testing, setTesting] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const keyRef = useRef<HTMLInputElement>(null);

  const valid = form.valid;
  const dirty = form.dirty || apiKey.trim() !== '';

  const applyPreset = (preset: AiConnectionPreset) => {
    form.setDraft({
      presetId: preset.id,
      name: preset.name,
      routeKind: preset.routeKind,
      baseUrl: preset.baseUrl,
      model: preset.model,
    });
    setModels([]);
    setModelError(null);
    setResult(null);
  };

  async function persist(): Promise<string> {
    const id = connection?.id ?? createdId;
    const saved = id
      ? await updateConnection(
          id,
          managed
            ? { model: draft.model }
            : {
                name: draft.name,
                routeKind: draft.routeKind,
                presetId: draft.presetId,
                baseUrl: draft.baseUrl,
                model: draft.model,
              },
        )
      : await createConnection({
          name: draft.name,
          routeKind: draft.routeKind,
          presetId: draft.presetId,
          baseUrl: draft.baseUrl,
          model: draft.model,
          protocol: 'openai-compatible',
          isActive: connections.length === 0,
        });
    if (!id) setCreatedId(saved.id);
    if (!managed && apiKey.trim()) {
      await saveKey(saved.id, apiKey);
      setApiKey('');
      setKeySaved(true);
    }
    return saved.id;
  }

  const requireKey = (): boolean => {
    if (keySaved || apiKey.trim()) return true;
    setModelError('先填写 API Key,再刷新模型或测试连接');
    keyRef.current?.focus();
    return false;
  };

  const handleSave = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const wasNew = !connection;
      const id = await persist();
      if (wasNew) onCreated(id);
      toast.success('AI 连接已保存');
    } catch (error) {
      reportConnectionError(error, '保存失败', '请检查连接信息');
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    if (!connection) {
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

  const handleLoadModels = async () => {
    if (!valid || !requireKey() || loadingModels) return;
    setLoadingModels(true);
    setModelError(null);
    try {
      // 刷新会先落库创建(沿用弹窗语义),但不切换选中:remount 会丢掉本地
      // 模型列表与测试结果;选中切换只在「保存」时发生(onCreated)。
      const id = await persist();
      const discovered = await listModels(id);
      setModels(mergeModels(draft.model, discovered));
      if (discovered.length === 0) setModelError('服务没有返回模型列表,当前手工模型 ID 已保留');
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
      // 同 handleLoadModels:落库创建但不切换选中
      const id = await persist();
      const validation = await validate(id);
      setResult(validation);
      setModels((current) => mergeModels(draft.model, [...current, ...validation.models]));
    } catch (error) {
      const message = reportConnectionError(error, '连接测试失败', '请检查连接信息');
      setResult({
        ok: false,
        message,
        models: [],
        capabilities: connection?.capabilities ?? FALLBACK_CAPABILITIES,
      });
    } finally {
      setTesting(false);
    }
  };

  const handleRevoke = async () => {
    const id = connection?.id ?? createdId;
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

  const handleDelete = async () => {
    if (!connection) return;
    try {
      await deleteConnection(connection.id);
      toast.success('AI 连接已删除');
      onDeleted();
    } catch (error) {
      toast.error('删除失败', error instanceof Error ? error.message : '请稍后重试');
    }
  };

  return (
    <div className="settings-detail-root" data-testid="ai-connection-detail">
      {/* 头部:名称 + 设为默认/默认徽标(删除操作已下沉到底部操作条左端) */}
      <div className="settings-detail-header">
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-medium text-primary">
          {connection ? connection.name : '添加 Agent 模型连接'}
        </h3>
        {connection?.isActive && <span className="settings-md-default-badge">默认</span>}
        {connection && relayMode && !connection.isActive && (
          <Button size="sm" variant="ghost" onClick={() => void setActive(connection.id)}>
            <Check className="h-3 w-3" /> 设为默认
          </Button>
        )}
      </div>

      <div className="settings-detail-form">
        {/* 预设卡片网格(仅新建态) */}
        {!connection && !managed && (
          <AiConnectionPresetGrid
            presets={presets}
            presetId={draft.presetId}
            onPick={applyPreset}
          />
        )}

        {!managed && (
          <>
            {/* 连接分组:名称 / 连接方式 / Base URL / API Key */}
            <div className="settings-detail-section">
              <PanelSectionTitle title="连接" testId="ai-connection-section-connection" />
              <div className="settings-detail-connection-fields">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="连接名称">
                    <Input
                      aria-label="连接名称"
                      value={draft.name}
                      onChange={(event) => form.setField('name', event.target.value)}
                      placeholder="例如:我的 DeepSeek"
                      data-testid="ai-connection-name"
                    />
                  </Field>
                  <Field label="连接方式">
                    <div
                      className="settings-detail-route-control grid grid-cols-2 gap-1 rounded-md border border-border-subtle bg-inset p-1"
                      data-testid="ai-connection-route-kind"
                    >
                      <RouteButton
                        active={draft.routeKind === 'direct'}
                        onClick={() => form.setField('routeKind', 'direct')}
                      >
                        厂商直连
                      </RouteButton>
                      <RouteButton
                        active={draft.routeKind === 'gateway'}
                        onClick={() => form.setField('routeKind', 'gateway')}
                      >
                        兼容网关
                      </RouteButton>
                    </div>
                  </Field>
                </div>

                <Field label="Base URL">
                  <Input
                    aria-label="Base URL"
                    value={draft.baseUrl}
                    onChange={(event) => form.setField('baseUrl', event.target.value)}
                    mono
                    placeholder="https://example.com/v1"
                    data-testid="ai-connection-base-url"
                  />
                </Field>

                <Field
                  label="API Key"
                  hint="费用由服务商或网关计费;刷新模型或测试连接会先保存当前填写内容。"
                >
                  {/* Stripe 式状态行:状态 + 掩码 + 撤销同排,渲染在输入框上方 */}
                  {keySaved && (
                    <div
                      className="settings-detail-status-row flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-success"
                      data-testid="ai-connection-key-status"
                    >
                      <Check className="h-3 w-3 shrink-0" />
                      <span className="font-medium">密钥已加密保存</span>
                      {connection?.keySuffix && (
                        <span className="font-mono text-success/80">
                          ····{connection.keySuffix}
                        </span>
                      )}
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        className="ml-auto shrink-0 text-tertiary hover:text-danger"
                        onClick={handleRevoke}
                        disabled={revoking}
                        data-testid="ai-connection-revoke-key"
                      >
                        {revoking ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Unplug className="h-3 w-3" />
                        )}
                        撤销
                      </Button>
                    </div>
                  )}
                  <div className="relative min-w-0">
                    <Input
                      ref={keyRef}
                      aria-label="API Key"
                      type={showKey ? 'text' : 'password'}
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                      placeholder={keySaved ? '已保存;输入新值可覆盖' : '输入 API Key'}
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
                      {showKey ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </Field>
              </div>
            </div>
          </>
        )}

        {/* 模型分组:行式列表 + 底部刷新 */}
        <div
          className={
            managed
              ? 'settings-detail-section'
              : 'settings-detail-section settings-detail-section--divider'
          }
        >
          <PanelSectionTitle
            title="模型"
            value={models.length > 0 ? `${models.length} 个可用模型` : undefined}
            testId="ai-connection-section-model"
          />
          <Field label="默认模型" hint="模型列表不可用时,可以保留并直接使用手工模型 ID。">
            <Input
              aria-label="默认模型"
              value={draft.model}
              onChange={(event) => form.setField('model', event.target.value)}
              mono
              placeholder="model-id"
              className={managed ? 'px-4 shadow-none' : undefined}
              data-testid="ai-connection-model"
            />
            {models.length > 0 && (
              <ModelOptionList
                items={models.map((item) => ({
                  id: item.id,
                  label: item.name || item.id,
                  mono: true,
                }))}
                selectedId={draft.model}
                onSelect={(id) => form.setField('model', id)}
                ariaLabel="可用文本模型"
                testId="ai-connection-model-options"
                optionTestId={(id) => `ai-model-option-${id}`}
              />
            )}
            <div className="mt-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className={managed ? 'shadow-none' : undefined}
                onClick={handleLoadModels}
                disabled={!valid || loadingModels || testing || saving}
                data-testid="ai-connection-load-models"
              >
                {loadingModels ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                刷新
              </Button>
            </div>
            {modelError && (
              <p
                className="mt-1 text-meta leading-relaxed text-warning"
                role="status"
                data-testid="ai-connection-model-error"
              >
                {modelError}
              </p>
            )}
          </Field>
        </div>

        {result && <CapabilityResult result={result} />}
      </div>

      {/* 底部操作条(sticky):左端删除(行内二次确认),右端 dirty 圆点 + 放弃 / 测试连接 / 保存 */}
      <PanelActions
        dirty={dirty}
        danger={
          connection && !managed ? (
            confirmDelete ? (
              <InlineConfirm
                label="确认删除连接?"
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
                aria-label={`删除 ${connection.name}`}
                title="删除连接"
                onClick={() => setConfirmDelete(true)}
                data-testid="ai-connection-delete"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )
          ) : undefined
        }
        onDiscard={handleDiscard}
        discardLabel={!connection && !createdId ? '取消' : '放弃'}
        discardDisabled={!dirty && Boolean(connection)}
        onTest={handleTest}
        testLabel="测试连接"
        testIcon={<KeyRound className="h-3.5 w-3.5" />}
        testBusy={testing}
        testDisabled={!valid || testing || saving}
        testTestId="ai-connection-test"
        onSave={handleSave}
        saveLabel={saving ? '保存中' : '保存'}
        saveBusy={saving}
        saveDisabled={!valid || saving || testing}
        saveTestId="ai-connection-save"
      />
    </div>
  );
}
