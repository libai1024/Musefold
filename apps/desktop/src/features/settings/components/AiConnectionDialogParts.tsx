import type { ReactNode, RefObject } from 'react';
import type {
  AiConnectionPreset,
  AiConnectionValidationResult,
} from '@musefold/desktop-contracts/ai';
import { AlertCircle, Check, Eye, EyeOff, Loader2, Unplug } from '../../../components/ui/icons';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { cn } from '../../../lib/utils';

/** 连接预设卡片网格(仅新建态):名称 + 推荐徽标 + 直连/网关说明 */
export function AiConnectionPresetGrid({
  presets,
  presetId,
  onPick,
}: {
  presets: readonly AiConnectionPreset[];
  presetId: AiConnectionPreset['id'];
  onPick: (preset: AiConnectionPreset) => void;
}) {
  const activePreset = presets.find((preset) => preset.id === presetId);
  return (
    <fieldset>
      <legend className="mb-1.5 text-[11px] font-medium text-secondary">连接预设</legend>
      <div
        className="settings-detail-preset-grid grid grid-cols-2 gap-1.5 sm:grid-cols-3"
        data-testid="ai-connection-presets"
      >
        {presets.map((preset) => {
          const selected = preset.id === presetId;
          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onPick(preset)}
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
                  <span
                    className={cn(
                      'shrink-0 px-1 py-px text-[8.5px] font-semibold',
                      selected ? 'text-background/70' : 'text-quaternary',
                    )}
                  >
                    推荐
                  </span>
                )}
              </span>
              <span
                className={cn(
                  'mt-0.5 block text-meta',
                  selected ? 'text-background/70' : 'text-tertiary',
                )}
              >
                {preset.routeKind === 'direct' ? '厂商直连' : '兼容网关'}
              </span>
            </button>
          );
        })}
      </div>
      {activePreset && (
        <p className="mt-1.5 text-meta leading-relaxed text-tertiary">{activePreset.hint}</p>
      )}
    </fieldset>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  /** useDraftForm errorFor 产出的校验错误,渲染在控件下方(text-danger) */
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="block">
      <span className="mb-1 block text-[11px] font-medium text-secondary">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-meta leading-relaxed text-tertiary">{hint}</span>}
      {error && (
        <p className="mt-1 text-meta leading-relaxed text-danger" data-testid="ai-connection-field-error">
          {error}
        </p>
      )}
    </div>
  );
}

/** 单选项:radiogroup 子项语义(role=radio + aria-checked),容器由调用方给 role="radiogroup" */
export function RouteButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        'h-7 rounded text-meta font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]',
        active ? 'bg-elevated text-primary' : 'text-tertiary hover:bg-hover hover:text-secondary',
      )}
    >
      {children}
    </button>
  );
}

export function CapabilityResult({ result }: { result: AiConnectionValidationResult }) {
  return (
    <div
      className={cn(
        'settings-detail-result rounded-md border px-3 py-2.5',

        result.ok ? 'border-success/35 bg-success/5' : 'border-danger/35 bg-danger/5',
      )}
      role="status"
      data-testid="ai-connection-capabilities"
    >
      {/* 头行:成功态 Check + 固定标题,失败态 AlertCircle;明细 message 随后 */}
      <p
        className={cn(
          'flex items-center gap-1 text-[11px] font-medium',
          result.ok ? 'text-success' : 'text-danger',
        )}
        data-testid="ai-connection-capabilities-title"
      >
        {result.ok ? (
          <Check className="h-3 w-3 shrink-0" />
        ) : (
          <AlertCircle className="h-3 w-3 shrink-0" />
        )}
        {result.ok ? '连接测试通过' : '连接测试未通过'}
      </p>
      <p
        className={cn(
          'mt-0.5 text-meta leading-relaxed',
          result.ok ? 'text-success/80' : 'text-danger/80',
        )}
      >
        {result.message}
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-x-5 gap-y-1 text-meta sm:grid-cols-4">
        <Capability label="文本请求" value={result.ok ? '可用' : '未通过'} />
        <Capability
          label="结构化策略"
          value={
            result.ok
              ? outputModeLabel(result.capabilities.preferredStructuredOutputMode)
              : '未检测'
          }
        />
        <Capability label="流式输出" value="本版本不使用" />
        <Capability
          label="取消请求"
          value={result.ok && result.capabilities.cancellation ? '支持' : '未检测'}
        />
      </dl>
    </div>
  );
}

function Capability({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-tertiary">{label}</dt>
      <dd className="mt-0.5 font-medium text-secondary">{value}</dd>
    </div>
  );
}

/** API Key 字段块(自 AiConnectionDetailPanel 析出):
 *  Stripe 式状态行(状态 + 掩码 + 撤销)+ 密码输入框 + 眼睛切换,密钥只写不读。 */
export function AiConnectionKeyField({
  keySaved,
  keySuffix,
  apiKey,
  onApiKeyChange,
  showKey,
  onToggleShowKey,
  keyInputRef,
  revoking,
  onRevoke,
}: {
  keySaved: boolean;
  keySuffix: string | null;
  apiKey: string;
  onApiKeyChange: (value: string) => void;
  showKey: boolean;
  onToggleShowKey: () => void;
  keyInputRef: RefObject<HTMLInputElement>;
  revoking: boolean;
  onRevoke: () => void;
}) {
  return (
    <Field
      label="API Key"
      hint="费用由服务商或网关计费;刷新模型或测试连接会先保存当前填写内容。"
    >
      {/* 状态行:状态 + 掩码 + 撤销同排,渲染在输入框上方 */}
      {keySaved && (
        <div
          className="settings-detail-status-row flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-success"
          data-testid="ai-connection-key-status"
        >
          <Check className="h-3 w-3 shrink-0" />
          <span className="font-medium">密钥已加密保存</span>
          {keySuffix && <span className="font-mono text-success/80">····{keySuffix}</span>}
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="ml-auto shrink-0 text-tertiary hover:text-danger"
            onClick={onRevoke}
            disabled={revoking}
            data-testid="ai-connection-revoke-key"
          >
            {revoking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unplug className="h-3 w-3" />}
            撤销
          </Button>
        </div>
      )}
      <div className="relative min-w-0">
        <Input
          ref={keyInputRef}
          aria-label="API Key"
          type={showKey ? 'text' : 'password'}
          value={apiKey}
          onChange={(event) => onApiKeyChange(event.target.value)}
          placeholder={keySaved ? '已保存;输入新值可覆盖' : '输入 API Key'}
          autoComplete="off"
          className="pr-9"
          data-testid="ai-connection-api-key"
        />
        <button
          type="button"
          onClick={onToggleShowKey}
          className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-tertiary hover:bg-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
          aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
          title={showKey ? '隐藏 API Key' : '显示 API Key'}
        >
          {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      </div>
    </Field>
  );
}

function outputModeLabel(
  mode: AiConnectionValidationResult['capabilities']['preferredStructuredOutputMode'],
): string {
  if (mode === 'json-schema') return 'JSON Schema 优先';
  if (mode === 'json-object') return 'JSON Object 优先';
  return '本地 JSON 校验';
}
