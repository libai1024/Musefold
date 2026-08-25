import type { ReactNode } from 'react';
import type {
  AiConnectionPreset,
  AiConnectionValidationResult,
} from '@musefold/desktop-contracts/ai';
import { AlertCircle, Check } from '../../../components/ui/icons';
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
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="block">
      <span className="mb-1 block text-[11px] font-medium text-secondary">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-meta leading-relaxed text-tertiary">{hint}</span>}
    </div>
  );
}

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
      aria-pressed={active}
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

function outputModeLabel(
  mode: AiConnectionValidationResult['capabilities']['preferredStructuredOutputMode'],
): string {
  if (mode === 'json-schema') return 'JSON Schema 优先';
  if (mode === 'json-object') return 'JSON Object 优先';
  return '本地 JSON 校验';
}
