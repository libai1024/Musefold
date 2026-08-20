// src/features/settings/components/SettingsView.tsx
// 设置主视图 —— Codex 式极简：左侧分组纯文字导航（排版承重，不用图标），右侧窄栏内容。
// 窄屏收敛为自绘分区菜单。
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from '../../../components/ui/icons';
import { useSettingsStore, type SettingsSection } from '../store';
import { ProvidersSection } from '../sections/ProvidersSection';
import { GenerationSection } from '../sections/GenerationSection';
import { AppearanceSection } from '../sections/AppearanceSection';
import { DataSection } from '../sections/DataSection';
import { AboutSection } from '../sections/AboutSection';
import { AiConnectionsSection } from '../sections/AiConnectionsSection';
import { ArchivedChatsSection } from '../sections/ArchivedChatsSection';
import { AutomationSection } from '../sections/AutomationSection';
import { AccountSection } from '../sections/AccountSection';
import { ConnectedAppsSection } from '../sections/ConnectedAppsSection';
import { DoubaoSection } from '../sections/DoubaoSection';
import { AccessModeSection } from '../sections/AccessModeSection';
import { cn } from '../../../lib/utils';

interface NavGroup {
  label: string;
  items: { key: SettingsSection; label: string }[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: '接入方式',
    items: [
      { key: 'access', label: 'AI 接入' },
      { key: 'doubao', label: '豆包网页版' },
      { key: 'account', label: 'Musefold 账号' },
      { key: 'connections', label: '已连接应用' },
    ],
  },
  {
    label: '高级设置',
    items: [
      { key: 'providers', label: '生图中转站' },
      { key: 'ai', label: 'Agent 中转站' },
    ],
  },
  {
    label: '创作偏好',
    items: [
      { key: 'generation', label: '生成默认值' },
      { key: 'appearance', label: '外观' },
    ],
  },
  {
    label: '数据',
    items: [
      { key: 'data', label: '数据与存储' },
    ],
  },
  {
    label: '开放能力',
    items: [
      { key: 'automation', label: '自动化' },
    ],
  },
  {
    label: '应用',
    items: [
      { key: 'about', label: '关于' },
      { key: 'archived', label: '已归档聊天' },
    ],
  },
];

const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);

const SECTIONS: Record<SettingsSection, () => JSX.Element> = {
  access: AccessModeSection,
  doubao: DoubaoSection,
  account: AccountSection,
  connections: ConnectedAppsSection,
  providers: ProvidersSection,
  ai: AiConnectionsSection,
  generation: GenerationSection,
  appearance: AppearanceSection,
  data: DataSection,
  automation: AutomationSection,
  about: AboutSection,
  archived: ArchivedChatsSection,
};

export function SettingsView() {
  const section = useSettingsStore((s) => s.section);
  const setSection = useSettingsStore((s) => s.setSection);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mobileNavRef = useRef<HTMLDivElement>(null);
  const Active = SECTIONS[section];
  const activeNav = NAV_ITEMS.find((item) => item.key === section) ?? NAV_ITEMS[0];

  useEffect(() => {
    if (!mobileNavOpen) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!mobileNavRef.current?.contains(event.target as Node)) setMobileNavOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNavOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePress);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [mobileNavOpen]);

  const chooseSection = (nextSection: SettingsSection) => {
    setSection(nextSection);
    setMobileNavOpen(false);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col min-[960px]:flex-row">
        {/* 窄屏只显示当前分区，展开时仍是应用内自绘菜单而非原生 select。 */}
        <div ref={mobileNavRef} className="relative z-20 border-b border-border-subtle p-2 min-[960px]:hidden">
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={mobileNavOpen}
            data-testid="settings-mobile-section-trigger"
            onClick={() => setMobileNavOpen((open) => !open)}
                className="settings-mobile-trigger no-drag flex h-9 w-full items-center gap-2 border-b border-border-subtle bg-transparent px-1 text-left text-[13px] font-medium text-primary transition-colors hover:border-border-default focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
          >
            <span className="min-w-0 flex-1 truncate">{activeNav.label}</span>
            <ChevronDown className={cn('h-4 w-4 shrink-0 text-tertiary transition-transform', mobileNavOpen && 'rotate-180')} />
          </button>
          {mobileNavOpen && (
            <div
              role="listbox"
              aria-label="设置分区"
              data-testid="settings-mobile-section-menu"
              className="absolute left-2 right-2 top-full -mt-1 rounded-lg border border-border-default bg-popover p-1 shadow-pop animate-scale-fade-in"
            >
              {NAV_GROUPS.map((group) => (
                <div key={group.label || group.items[0].key} role="group" aria-label={group.label || group.items[0].label}>
                  {group.label && <p className="px-2.5 pb-0.5 pt-2 text-[9.5px] font-medium text-quaternary first:pt-1">{group.label}</p>}
                  {group.items.map((item) => {
                    const active = item.key === section;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        role="option"
                        aria-selected={active}
                        data-testid={`settings-mobile-section-${item.key}`}
                        onClick={() => chooseSection(item.key)}
                        className={cn(
                          'no-drag flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition-colors',
                          active ? 'bg-pressed text-primary' : 'text-secondary hover:bg-hover hover:text-primary',
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {active && <Check className="h-3.5 w-3.5 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 桌面左侧分区导航：纯文字 + 分组标签，Codex 式排版承重 */}
        <nav className="settings-nav hidden w-[204px] shrink-0 flex-col overflow-y-auto border-r border-border-subtle px-4 pb-6 pt-7 min-[960px]:flex" aria-label="设置分区">
          <h1 className="px-2 pb-4 text-[15px] font-semibold tracking-tight text-primary">设置</h1>
          {NAV_GROUPS.map((group) => (
            <div key={group.label || group.items[0].key} className="mb-4 last:mb-0">
              {group.label && <p className="px-2 pb-1 text-[9.5px] font-medium tracking-wide text-quaternary">{group.label}</p>}
              <div className="flex flex-col gap-px">
                {group.items.map((item) => {
                  const active = item.key === section;
                  return (
                    <button
                      key={item.key}
                      onClick={() => chooseSection(item.key)}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'settings-nav__item no-drag flex h-7 items-center rounded-md px-2 text-left text-[12.5px] transition-colors',
                        active
                          ? 'bg-pressed font-medium text-primary'
                          : 'text-secondary hover:bg-hover hover:text-primary'
                      )}
                    >
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* 右侧内容 */}
        <div className="settings-content min-h-0 min-w-0 flex-1 overflow-y-auto scroll-smooth px-6 py-8 min-[960px]:px-12 min-[960px]:py-10">
          <Active />
        </div>
      </div>
    </div>
  );
}
