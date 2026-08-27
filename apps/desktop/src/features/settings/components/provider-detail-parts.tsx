// src/features/settings/components/provider-detail-parts.tsx
// 生图中转站详情面板的子块(RELAY-SETTINGS-UI 第二步):
// 面板头部(默认徽标/设为默认)、新建态预设卡片网格、连接分组(名称/Base URL/API Key)
// —— 从 ProviderDetailPanel 析出以满足文件尺寸门禁。
// doubao-web 分支已随面板死代码清理移除:station 列表(ProvidersSection)已过滤该类型,
// 完整语义仍由 generation 弹窗 ProviderDialog 承载。

import type { RefObject } from 'react';
import { PROVIDER_PRESETS, type ProviderPreset } from '@musefold/domain/constants';
import { ProviderField as Field } from '@renderer/runtime/generation-access';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Check, Eye, EyeOff, Link2 } from '../../../components/ui/icons';
import { cn } from '../../../lib/utils';
import { PanelSectionTitle } from './MasterDetail';

/** 详情面板头部:标题 + 默认徽标 / 设为默认(删除操作已下沉到底部操作条左端) */
export function ProviderDetailHeader({
  title,
  isActive,
  showSetDefault,
  onSetDefault,
}: {
  title: string;
  /** relay 语义下的当前默认项 */
  isActive: boolean;
  /** relay 模式下才允许切换默认 */
  showSetDefault: boolean;
  onSetDefault: () => void;
}) {
  return (
    <div className="settings-detail-header">
      <h3 className="min-w-0 flex-1 truncate text-[13px] font-medium text-primary">{title}</h3>
      {isActive && <span className="settings-md-default-badge">默认</span>}
      {showSetDefault && (
        <Button size="sm" variant="ghost" onClick={onSetDefault}>
          <Check className="h-3 w-3" /> 设为默认
        </Button>
      )}
    </div>
  );
}

/** 接入预设选择(仅新建态):与 Agent 侧连接预设同构的卡片网格(名称 + hint 摘要) */
export function ProviderPresetPicker({
  presetId,
  onPick,
}: {
  presetId: string;
  onPick: (preset: ProviderPreset) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-[11px] font-medium text-secondary">接入预设</legend>
      <div
        className="settings-detail-preset-grid grid grid-cols-2 gap-1.5 sm:grid-cols-3"
        data-testid="provider-preset-grid"
      >
        {PROVIDER_PRESETS.filter((p) => p.type !== 'doubao-web').map((p) => {
          const active = p.id === presetId;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={active}
              onClick={() => onPick(p)}
              data-active={active ? 'true' : 'false'}
              data-testid={`provider-preset-option-${p.id}`}
              className={cn(
                'no-drag min-h-10 rounded-md border px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]',
                active
                  ? 'border-transparent bg-primary text-background'
                  : 'border-border-subtle bg-elevated text-secondary hover:border-border-strong hover:bg-hover hover:text-primary',
              )}
            >
              <span className="flex items-center gap-1">
                <span className="min-w-0 truncate text-[11.5px] font-medium">{p.name}</span>
                {p.recommended && (
                  <span
                    className={cn(
                      'shrink-0 px-1 py-px text-[8.5px] font-semibold',
                      active ? 'text-background/70' : 'text-quaternary',
                    )}
                  >
                    推荐
                  </span>
                )}
              </span>
              <span
                className={cn(
                  'mt-0.5 line-clamp-2 block text-meta leading-relaxed',
                  active ? 'text-background/70' : 'text-tertiary',
                )}
              >
                {p.hint}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** 密钥状态行:keySaved 时渲染在 Key 输入框上方(状态 + 掩码 + 管理说明) */
export function ApiKeyStatusRow({ keySuffix }: { keySuffix?: string }) {
  return (
    <div
      className="settings-detail-status-row flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-success"
      data-testid="provider-api-key-status"
    >
      <Check className="h-3 w-3 shrink-0" />
      <span className="font-medium">密钥已加密保存</span>
      {keySuffix && <span className="font-mono text-success/80">····{keySuffix}</span>}
      <span className="ml-auto min-w-0 truncate pl-2 text-success/70">输入新值可覆盖</span>
    </div>
  );
}

/** 连接分组:名称 / Base URL / API Key(自 ProviderDetailPanel 析出;密钥只写不读) */
export function ProviderConnectionSection({
  name,
  baseUrl,
  onNameChange,
  onBaseUrlChange,
  onNameTouch,
  onBaseUrlTouch,
  nameError,
  baseUrlError,
  keySaved,
  keySuffix,
  apiKey,
  onApiKeyChange,
  showKey,
  onToggleShowKey,
  keyInputRef,
  keyUrl,
}: {
  name: string;
  baseUrl: string;
  onNameChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  /** blur 触达:点亮该字段的校验错误 */
  onNameTouch: () => void;
  onBaseUrlTouch: () => void;
  nameError?: string;
  baseUrlError?: string;
  keySaved: boolean;
  keySuffix?: string;
  apiKey: string;
  onApiKeyChange: (value: string) => void;
  showKey: boolean;
  onToggleShowKey: () => void;
  keyInputRef: RefObject<HTMLInputElement>;
  /** 预设的密钥获取地址:未保存密钥时渲染为可点链接 */
  keyUrl?: string;
}) {
  return (
    <div className="settings-detail-section">
      <PanelSectionTitle title="连接" testId="provider-section-connection" />
      <Field label="名称" error={nameError}>
        <Input
          aria-label="名称"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          onBlur={onNameTouch}
          placeholder="如:我的中转站"
          data-testid="provider-name"
        />
      </Field>
      <Field label="Base URL" error={baseUrlError}>
        <Input
          aria-label="Base URL"
          value={baseUrl}
          onChange={(e) => onBaseUrlChange(e.target.value)}
          onBlur={onBaseUrlTouch}
          placeholder="https://ai.tvt.wiki/v1"
          data-testid="provider-base-url"
        />
      </Field>
      <Field label="API Key">
        {keySaved && <ApiKeyStatusRow keySuffix={keySuffix} />}
        <div className="relative">
          <Input
            ref={keyInputRef}
            aria-label="API Key"
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            placeholder={keySaved ? '已保存(输入新值可覆盖)' : 'sk-...'}
            autoComplete="off"
            className="pr-9"
            data-testid="provider-api-key"
          />
          <button
            type="button"
            onClick={onToggleShowKey}
            className="no-drag absolute right-2 top-1/2 -translate-y-1/2 text-tertiary hover:text-secondary"
            aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
            title={showKey ? '隐藏 API Key' : '显示 API Key'}
          >
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {keyUrl && !keySaved && (
          <a
            href={keyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 flex items-center gap-1 font-mono text-[11px] text-tertiary underline-offset-2 hover:text-secondary hover:underline"
            data-testid="provider-key-url"
          >
            <Link2 className="h-3 w-3 shrink-0" /> {keyUrl}
          </a>
        )}
      </Field>
    </div>
  );
}
