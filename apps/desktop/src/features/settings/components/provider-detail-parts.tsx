// src/features/settings/components/provider-detail-parts.tsx
// 生图中转站详情面板的子块(RELAY-SETTINGS-UI 第二步):
// 面板头部(默认徽标/设为默认)、新建态预设卡片网格、密钥状态行、
// doubao-web 登录 —— 从 ProviderDetailPanel 析出以满足文件尺寸门禁。

import { PROVIDER_PRESETS, type ProviderPreset } from '@musefold/domain/constants';
import { ProviderField as Field } from '@renderer/runtime/generation-access';
import { Button } from '../../../components/ui/button';
import { AlertCircle, Check, ExternalLink, Loader2 } from '../../../components/ui/icons';
import { cn } from '../../../lib/utils';

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

/** doubao-web 分支:无 Base URL/Key 字段,操作改为「打开登录窗口」 */
export function DoubaoWebLoginField({
  keySaved,
  openingWebLogin,
  busy,
  onOpen,
}: {
  keySaved: boolean;
  openingWebLogin: boolean;
  busy: boolean;
  onOpen: () => void;
}) {
  return (
    <Field label="豆包账号">
      <div className="settings-detail-inset flex items-center justify-between gap-3 p-3">
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-primary">
            {keySaved ? '网页会话已连接' : '需要登录豆包网页版'}
          </p>
          <p className="mt-0.5 text-meta leading-relaxed text-tertiary">
            登录状态保存在本机专用浏览器会话中;验证码和安全验证始终由你手动完成。
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onOpen}
          disabled={openingWebLogin || busy}
          data-testid="provider-open-web-login"
          className="shrink-0"
        >
          {openingWebLogin ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ExternalLink className="h-3.5 w-3.5" />
          )}
          {keySaved ? '重新登录' : '打开登录'}
        </Button>
      </div>
      <p className="mt-1.5 flex items-start gap-1 text-[11px] leading-relaxed text-tertiary">
        <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
        此接入依赖豆包网页结构,属于实验功能;出现验证或结构变化时会停止自动化并显示豆包窗口。
      </p>
    </Field>
  );
}
