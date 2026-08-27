// src/features/settings/components/AiConnectionDetailPanel.tsx
// Agent 中转站详情面板(RELAY-SETTINGS-UI 第二步):master-detail 右栏,选中即编辑。
// 草稿态用 product-ui 的 useDraftForm,显式「保存 / 放弃」,不再走弹窗。
// 编排动作(持久化/测试/刷新/撤销/删除)在 ai-connection-panel-hooks;
// 预设网格与 API Key 字段块在 AiConnectionDialogParts;模型分组在 AiConnectionModelSection;
// 底部操作条与分组标题复用 MasterDetail 的 PanelActions / PanelSectionTitle(与生图面板同构)。
import { useEffect, useState, type ReactNode } from 'react';
import type {
  AiConnectionPreset,
  AiConnectionProfile,
} from '@musefold/desktop-contracts/ai';
import { Check, KeyRound, Trash2 } from '../../../components/ui/icons';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { useAiConnectionStore } from '../ai-connection-store';
import {
  CapabilityResult,
  AiConnectionKeyField,
  AiConnectionPresetGrid,
  Field,
  RouteButton,
} from './AiConnectionDialogParts';
import { InlineConfirm, PanelActions, PanelSectionTitle } from './MasterDetail';
import { AiConnectionModelSection } from './AiConnectionModelSection';
import { useAiConnectionPanelController } from './ai-connection-panel-hooks';

interface Props {
  /** null = 新建草稿(未落库,保存/测试/刷新时才创建) */
  connection: AiConnectionProfile | null;
  /** 新建时预选的连接预设 id(空态快捷入口) */
  presetSeed?: AiConnectionPreset['id'] | null;
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

/** 连接方式的渐进披露说明:与主进程结构化输出默认策略对齐(direct=json-schema / gateway=json-object) */
const ROUTE_HINTS: Record<AiConnectionProfile['routeKind'], string> = {
  direct: '直连:直接访问服务商 API',
  gateway: '网关:经中转站转发,支持结构化输出策略',
};

export function AiConnectionDetailPanel({
  connection,
  presetSeed,
  relayMode,
  onDirtyChange,
  dirtyGuard,
  onCreated,
  onDiscardNew,
  onDeleted,
}: Props) {
  const setActive = useAiConnectionStore((state) => state.setActive);
  const panel = useAiConnectionPanelController({
    connection,
    presetSeed,
    onCreated,
    onDiscardNew,
    onDeleted,
  });
  const {
    draft,
    form,
    dirty,
    loadModelsReady,
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
    applyPreset,
    handleSave,
    handleLoadModels,
    handleTest,
    handleRevoke,
    handleDelete,
  } = panel;

  const [showKey, setShowKey] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const handleDiscard = () => {
    panel.handleDiscard();
    setShowKey(false);
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
        {!connection && (
          <AiConnectionPresetGrid
            presets={panel.presets}
            presetId={draft.presetId}
            onPick={applyPreset}
          />
        )}

        {/* 连接分组:名称 / 连接方式 / Base URL / API Key */}
        <div className="settings-detail-section">
          <PanelSectionTitle title="连接" testId="ai-connection-section-connection" />
          <div className="settings-detail-connection-fields">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="连接名称" error={form.errorFor('name')}>
                <Input
                  aria-label="连接名称"
                  value={draft.name}
                  onChange={(event) => form.setField('name', event.target.value)}
                  onBlur={() => form.markTouched('name')}
                  placeholder="例如:我的 DeepSeek"
                  data-testid="ai-connection-name"
                />
              </Field>
              <Field label="连接方式">
                <div
                  role="radiogroup"
                  aria-label="连接方式"
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
                <span className="mt-1 block text-meta leading-relaxed text-tertiary">
                  {ROUTE_HINTS[draft.routeKind]}
                </span>
              </Field>
            </div>

            <Field label="Base URL" error={form.errorFor('baseUrl')}>
              <Input
                aria-label="Base URL"
                value={draft.baseUrl}
                onChange={(event) => form.setField('baseUrl', event.target.value)}
                onBlur={() => form.markTouched('baseUrl')}
                mono
                placeholder="https://example.com/v1"
                data-testid="ai-connection-base-url"
              />
            </Field>

            <AiConnectionKeyField
              keySaved={keySaved}
              keySuffix={connection?.keySuffix ?? null}
              apiKey={apiKey}
              onApiKeyChange={setApiKey}
              showKey={showKey}
              onToggleShowKey={() => setShowKey((shown) => !shown)}
              keyInputRef={keyRef}
              revoking={revoking}
              onRevoke={() => void handleRevoke()}
            />
          </div>
        </div>

        {/* 模型分组:行式列表 + 底部刷新(本体在 AiConnectionModelSection) */}
        <AiConnectionModelSection
          model={draft.model}
          onModelChange={(value) => form.setField('model', value)}
          onModelTouch={() => form.markTouched('model')}
          error={form.errorFor('model')}
          models={models}
          onLoadModels={handleLoadModels}
          loadDisabled={!loadModelsReady || testing || saving}
          loadingModels={loadingModels}
          modelError={modelError}
        />

        {result && <CapabilityResult result={result} />}
      </div>

      {/* 底部操作条(sticky):左端删除(行内二次确认),右端 dirty 圆点 + 放弃 / 测试连接 / 保存 */}
      <PanelActions
        dirty={dirty}
        guard={dirtyGuard}
        danger={
          connection ? (
            confirmDelete ? (
              <InlineConfirm
                label="确认删除此连接?"
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
        discardLabel={!connection ? (createdId ? (dirty ? '放弃' : '完成') : '取消') : '放弃'}
        discardDisabled={!dirty && Boolean(connection)}
        onTest={handleTest}
        testLabel="测试连接"
        testIcon={<KeyRound className="h-3.5 w-3.5" />}
        testBusy={testing}
        testDisabled={!panel.valid || testing || saving}
        testTestId="ai-connection-test"
        onSave={handleSave}
        saveLabel={saving ? '保存中…' : '保存'}
        saveDisabled={testing || saving}
        saveTestId="ai-connection-save"
      />
    </div>
  );
}
