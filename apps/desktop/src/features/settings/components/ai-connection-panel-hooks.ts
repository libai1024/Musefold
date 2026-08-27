// src/features/settings/components/ai-connection-panel-hooks.ts
// Agent 中转站详情面板的编排动作与草稿类型(RELAY-SETTINGS-UI 第二步,自 AiConnectionDetailPanel 析出):
// 面板入口(AiConnectionsSection)已过滤 managedBy==='account',托管分支在本面板不可达、已移除。
// 纯渲染状态(showKey/confirmDelete)留在面板,store/草稿/异步动作全部收拢在 controller 内。

import { useMemo, useRef, useState } from 'react';
import type {
  AiConnectionPreset,
  AiConnectionProfile,
  AiConnectionRouteKind,
  AiConnectionValidationResult,
  AiTextModelInfo,
} from '@musefold/desktop-contracts/ai';
import { useDraftForm } from '@musefold/product-ui';
import { useAiConnectionStore } from '../ai-connection-store';
import { toast } from '../../../stores/toast';
import {
  FALLBACK_CAPABILITIES,
  mergeModels,
  reportConnectionError,
} from './ai-connection-panel-utils';

export const AI_CONNECTION_DRAFT_FIELDS = ['name', 'baseUrl', 'model'] as const;

/** 参与 dirty/校验的实体字段;API Key(只写)留在局部状态 */
export interface AiConnectionDraft {
  presetId: AiConnectionPreset['id'];
  name: string;
  routeKind: AiConnectionRouteKind;
  baseUrl: string;
  model: string;
}

export type AiConnectionDraftField = (typeof AI_CONNECTION_DRAFT_FIELDS)[number];

/** 新建草稿的预设回落(presets 为空时的最终兜底,与主进程预设目录同款占位) */
const FALLBACK_PRESET_DRAFT: AiConnectionDraft = {
  presetId: 'custom',
  name: '我的文本模型',
  routeKind: 'gateway',
  baseUrl: 'https://example.com/v1',
  model: 'model-id',
};

export function useAiConnectionPanelController({
  connection,
  presetSeed,
  onCreated,
  onDiscardNew,
  onDeleted,
}: {
  /** null = 新建草稿(未落库,保存/测试/刷新时才创建) */
  connection: AiConnectionProfile | null;
  /** 新建时预选的连接预设 id(空态快捷入口) */
  presetSeed?: AiConnectionPreset['id'] | null;
  onCreated: (id: string) => void;
  onDiscardNew: () => void;
  onDeleted: () => void;
}) {
  const presets = useAiConnectionStore((state) => state.presets);
  const connections = useAiConnectionStore((state) => state.connections);
  const createConnection = useAiConnectionStore((state) => state.createConnection);
  const updateConnection = useAiConnectionStore((state) => state.updateConnection);
  const deleteConnection = useAiConnectionStore((state) => state.deleteConnection);
  const saveKey = useAiConnectionStore((state) => state.saveKey);
  const deleteKey = useAiConnectionStore((state) => state.deleteKey);
  const listModels = useAiConnectionStore((state) => state.listModels);
  const validate = useAiConnectionStore((state) => state.validate);

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
    return { ...FALLBACK_PRESET_DRAFT };
    // 只随选中条目/预设种子重建草稿,避免无关 store 更新打断编辑
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
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [models, setModels] = useState<AiTextModelInfo[]>([]);
  const [modelError, setModelError] = useState<string | null>(null);
  const [result, setResult] = useState<AiConnectionValidationResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [testing, setTesting] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const keyRef = useRef<HTMLInputElement>(null);

  const valid = form.valid;
  const dirty = form.dirty || apiKey.trim() !== '';

  /** 刷新模型只依赖名称 + Base URL(模型可留空,拉到列表后再选);保存仍要求完整必填 */
  const loadModelsReady = !form.errors.name && !form.errors.baseUrl;

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

  /** 持久化:新建则创建(首个自动设为默认),已有则更新;有新密钥则加密保存。返回连接 id。
   *  模型留空时(刷新路径):已有记录的更新补丁省略 model(主进程保留原值);
   *  新建草稿用预设默认模型占位满足主进程非空校验,拉取成功后自动选中真实模型。 */
  async function persist(): Promise<string> {
    const id = connection?.id ?? createdId;
    const model = draft.model.trim()
      ? draft.model
      : id
        ? undefined
        : presets.find((preset) => preset.id === draft.presetId)?.model || 'model-id';
    const saved = id
      ? await updateConnection(id, {
          name: draft.name,
          routeKind: draft.routeKind,
          presetId: draft.presetId,
          baseUrl: draft.baseUrl,
          ...(model ? { model } : {}),
        })
      : await createConnection({
          name: draft.name,
          routeKind: draft.routeKind,
          presetId: draft.presetId,
          baseUrl: draft.baseUrl,
          model: model ?? 'model-id',
          protocol: 'openai-compatible',
          isActive: connections.length === 0,
        });
    if (!id) setCreatedId(saved.id);
    if (apiKey.trim()) {
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
    if (saving) return;
    // 缺必填时保存按钮可点:点一下点亮全部字段错误,而不是静默置灰
    if (!valid) {
      form.touchAll(AI_CONNECTION_DRAFT_FIELDS);
      return;
    }
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
      // 新建草稿已被测试/刷新隐式落库:按钮此时为「完成」,保留并选中该条目
      if (createdId) onCreated(createdId);
      else onDiscardNew();
      return;
    }
    form.reset();
    setApiKey('');
    setResult(null);
    setModelError(null);
  };

  const handleLoadModels = async () => {
    if (!loadModelsReady || !requireKey() || loadingModels) return;
    setLoadingModels(true);
    setModelError(null);
    try {
      // 刷新会先落库创建(沿用弹窗语义),但不切换选中:remount 会丢掉本地
      // 模型列表与测试结果;选中切换只在「保存/完成」时发生(onCreated)。
      const wasImplicitCreate = !connection && !createdId;
      const id = await persist();
      // 落库内容即当前表单值:重置 dirty 基线,后续修改才算未保存。
      form.markPristine();
      if (wasImplicitCreate) toast.success('AI 连接已创建');
      const discovered = await listModels(id);
      setModels(mergeModels(draft.model, discovered));
      // 模型留空时(刷新不要求模型必填)自动选首个可用模型
      if (!draft.model.trim() && discovered.length > 0) form.setField('model', discovered[0].id);
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
      const wasImplicitCreate = !connection && !createdId;
      const id = await persist();
      form.markPristine();
      if (wasImplicitCreate) toast.success('AI 连接已创建');
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

  return {
    // 草稿与派生态
    presets,
    draft,
    form,
    valid,
    dirty,
    loadModelsReady,
    // 瞬时状态
    apiKey,
    setApiKey,
    keySaved,
    createdId,
    models,
    modelError,
    result,
    saving,
    loadingModels,
    testing,
    revoking,
    keyRef,
    // 动作
    applyPreset,
    handleSave,
    handleDiscard,
    handleLoadModels,
    handleTest,
    handleRevoke,
    handleDelete,
  };
}
