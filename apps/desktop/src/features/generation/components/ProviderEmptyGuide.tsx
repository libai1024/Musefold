// src/features/generation/components/ProviderEmptyGuide.tsx
// 零 Provider 空态引导（CODEX 行式）：
// 未登录时首行给「登录 Musefold 账号」推荐路径（与引导流一致），
// 其后是 BYOK 预设行与自定义添加入口。

import { ArrowRight, Plus, QrCode, UserRound } from '../../../components/ui/icons';
import {
  DOUBAO_WEB_DAILY_IMAGE_LIMIT,
  PROVIDER_PRESETS,
} from '@musefold/domain/constants';
import { useAppStore } from '../../../stores/app';
import { useSettingsStore } from '../../settings/store';
import { useAccountStore } from '../../account/store';
import { useGenerationStore } from '../store';
import { cn } from '../../../lib/utils';

interface Props {
  /** 场景文案微调 */
  context?: 'generate' | 'studio' | 'settings';
  className?: string;
  /** 覆盖 data-testid 根节点（生成 e2e 用 generate-empty-provider） */
  testId?: string;
}

const COPY: Record<NonNullable<Props['context']>, { title: string; hint: string }> = {
  generate: {
    title: '还没有生图模型',
    hint: '连接豆包网页版或登录 Musefold 账号，也可以在高级设置中接入中转站。',
  },
  studio: {
    title: '还没有生图模型',
    hint: '制作工作台需要先连接生图模型。可使用豆包网页版、Musefold 账号或高级中转站。',
  },
  settings: {
    title: '还没有生图中转站',
    hint: '从预设一键接入或自定义添加，再选择该中转站使用的生图模型。',
  },
};

export function ProviderEmptyGuide({
  context = 'settings',
  className,
  testId = 'provider-empty-guide',
}: Props) {
  const openProviderDialog = useGenerationStore((s) => s.openProviderDialog);
  const setView = useAppStore((s) => s.setView);
  const setSettingsSection = useSettingsStore((s) => s.setSection);
  const loggedIn = useAccountStore((s) => s.status.loggedIn);
  const copy = COPY[context];

  const openNew = (presetId?: string) => {
    openProviderDialog(null, presetId ? { presetId } : undefined);
  };

  const openAccount = () => {
    setSettingsSection('account');
    setView('settings');
  };
  const openDoubao = () => {
    setSettingsSection('doubao');
    setView('settings');
  };

  return (
    <div
      className={cn('flex w-full flex-col px-6 py-8', context !== 'settings' && 'mx-auto max-w-[26rem]', className)}
      data-testid={testId}
    >
      <p className="text-[13px] font-medium text-primary">{copy.title}</p>
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-tertiary">{copy.hint}</p>

      <div className="mt-5 divide-y divide-border-subtle border-y border-border-subtle">
        {context !== 'settings' && (
          <button
            type="button"
            onClick={openDoubao}
            className="no-drag group flex min-h-11 w-full items-center gap-3 py-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            data-testid="provider-empty-doubao"
          >
            <QrCode className="h-4 w-4 shrink-0 text-tertiary" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-[12px] font-medium text-primary">
                豆包扫码登录
                <span className="text-[10px] font-normal text-tertiary">每日 {DOUBAO_WEB_DAILY_IMAGE_LIMIT} 次</span>
              </span>
              <span className="mt-0.5 block text-[10.5px] leading-relaxed text-tertiary">使用本机独立浏览器会话，无需 API Key。</span>
            </span>
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-quaternary transition-transform group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
          </button>
        )}
        {!loggedIn && context !== 'settings' && (
          <button
            type="button"
            onClick={openAccount}
            className="no-drag group flex w-full items-center gap-3 py-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
            data-testid="provider-empty-login"
          >
            <UserRound className="h-4 w-4 shrink-0 text-tertiary" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-[12px] font-medium text-primary">
                登录 Musefold 账号
                <span className="rounded-full border border-border-default px-1.5 py-px text-[9px] font-medium text-tertiary">推荐</span>
              </span>
              <span className="mt-0.5 block text-[10.5px] leading-relaxed text-tertiary">
                一次登录，生图与 Agent 自动配置，无需 API Key。
              </span>
            </span>
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-quaternary transition-transform group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
          </button>
        )}
        {PROVIDER_PRESETS.filter((preset) => preset.type !== 'doubao-web').map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => openNew(preset.id)}
            data-testid={`provider-preset-${preset.id}`}
            className="no-drag group flex w-full items-center gap-3 py-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-[12px] font-medium text-primary">
                {preset.name}
                {preset.recommended && <span className="text-[10px] font-normal text-tertiary">自备推荐</span>}
              </span>
              <span className="mt-0.5 line-clamp-2 block text-[10.5px] leading-relaxed text-tertiary">{preset.hint}</span>
            </span>
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-quaternary transition-transform group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
          </button>
        ))}
        <button
          type="button"
          onClick={() => openNew()}
          data-testid={context === 'generate' ? 'generate-add-provider' : 'provider-add-first'}
          className="no-drag group flex w-full items-center gap-3 py-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
        >
          <Plus className="h-4 w-4 shrink-0 text-tertiary" aria-hidden="true" />
          <span className="flex-1 text-[12px] font-medium text-primary">自定义添加服务商</span>
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-quaternary transition-transform group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
