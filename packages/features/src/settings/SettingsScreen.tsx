import { useCapabilities } from '@musefold/platform';
import { Badge } from '@musefold/ui/components/badge';
import { Button } from '@musefold/ui/components/button';
import { Input } from '@musefold/ui/components/input';
import { ChevronLeft, ChevronRight, Search } from '@musefold/ui/icons';
import { cn } from '@musefold/ui/lib/utils';
import { useEffect, useMemo, useState } from 'react';
import { useScreenIntent } from '../shell/screen-intent-store';
import {
  availableSettingsSections,
  filterSettingsSections,
  SETTINGS_GROUPS,
  type SettingsSectionContext,
  type SettingsSectionDefinition,
  type SettingsSectionId,
  sectionForIntent,
} from './sections';
import { useSettingsNav } from './settings-nav-store';

export interface SettingsScreenProps {
  /** 「数据」分区回收站入口的切屏回调;缺省不注册该分区(宿主未接线时)。 */
  onOpenScreen?(id: 'prompts' | 'history'): void;
}

/** 深链意图(侧栏账号菜单等)只在挂载时消费一次;StrictMode 双跑安全:第二次消费不到即返回 null。 */
function consumeSettingsIntent(
  consume: ReturnType<typeof useScreenIntent.getState>['consume'],
): 'settings-account' | 'settings-connections' | null {
  if (consume('settings-account')) return 'settings-account';
  if (consume('settings-connections')) return 'settings-connections';
  return null;
}

/**
 * 设置屏幕(V25-UI-SPEC §6):分区注册表驱动。
 * - md+:左分组导航(220px,含搜索)+ 右分区面板;
 * - 移动:一级分区列表 → 二级面板(带返回),深链直接进二级;
 * - 分区记忆:离开再回来停在上次分区(内存态);分区不可用时兜底首个可用分区;
 * - 深链:侧栏账号菜单意图落到对应分区并短暂点亮面板。
 * 同一份组件在 Next.js 壳与 Electron 壳渲染,宿主差异只经 capabilities 进入注册表的 isAvailable。
 */
export function SettingsScreen({ onOpenScreen }: SettingsScreenProps = {}) {
  const capabilities = useCapabilities();
  const consume = useScreenIntent((s) => s.consume);
  const rememberedId = useSettingsNav((s) => s.activeSectionId);
  const remember = useSettingsNav((s) => s.setActiveSectionId);

  const context = useMemo<SettingsSectionContext>(
    () => ({ capabilities, onOpenScreen }),
    [capabilities, onOpenScreen],
  );
  const sections = useMemo(() => availableSettingsSections(context), [context]);

  // 挂载时一次性裁决初始分区:深链意图 > 记忆 > 首个可用分区。深链同时把移动端推进二级面板。
  const [initial] = useState(() => {
    const intent = consumeSettingsIntent(useScreenIntent.getState().consume);
    const fromIntent = intent ? sectionForIntent(intent, sections) : null;
    return {
      sectionId: fromIntent ?? rememberedId ?? sections[0]?.id ?? null,
      fromIntent: fromIntent !== null,
    };
  });
  const [activeId, setActiveId] = useState<SettingsSectionId | null>(initial.sectionId);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(initial.fromIntent);
  const [highlight, setHighlight] = useState(initial.fromIntent);
  const [query, setQuery] = useState('');

  // 记忆分区尚存但宿主已不提供(如能力切换)时兜底首个可用分区,避免空面板。
  const active: SettingsSectionDefinition | null =
    sections.find((section) => section.id === activeId) ?? sections[0] ?? null;

  useEffect(() => {
    if (active) remember(active.id);
  }, [active, remember]);

  useEffect(() => {
    // 挂载后清掉可能残留的另一种意图(StrictMode 首跑已消费主意图)。
    consumeSettingsIntent(consume);
  }, [consume]);

  useEffect(() => {
    if (!highlight) return;
    // 不做 cleanup:StrictMode 双跑时 cleanup 会把首跑的高亮吞掉;卸载后到点 setState 是无害 no-op。
    window.setTimeout(() => setHighlight(false), 1_800);
  }, [highlight]);

  const filtered = useMemo(() => filterSettingsSections(sections, query), [sections, query]);
  const groups = SETTINGS_GROUPS.map((group) => ({
    ...group,
    sections: filtered.filter((section) => section.group === group.id),
  })).filter((group) => group.sections.length > 0);

  function openSection(id: SettingsSectionId) {
    setActiveId(id);
    setMobilePanelOpen(true);
    setHighlight(false);
  }

  const ActiveIcon = active?.icon;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6" data-testid="settings-screen">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-semibold text-foreground text-xl">设置</h1>
          <p className="mt-1 text-muted-foreground text-sm">外观、账号、连接与数据</p>
        </div>
        <Badge variant="secondary" data-testid="settings-host-badge">
          {capabilities.host === 'desktop' ? '桌面版' : 'Web 版'}
        </Badge>
      </header>

      <div className="grid gap-6 md:grid-cols-[220px_minmax(0,1fr)] md:items-start">
        {/* 分组导航:md+ 常驻;移动端在未进入二级面板时作为一级列表。 */}
        <nav
          aria-label="设置分区"
          className={cn('flex flex-col gap-4', mobilePanelOpen ? 'hidden md:flex' : 'flex')}
          data-testid="settings-nav"
        >
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索设置"
              aria-label="搜索设置"
              className="h-9 pl-8"
              data-testid="settings-search"
            />
          </div>
          {groups.length === 0 ? (
            <p className="px-2 text-muted-foreground text-sm" data-testid="settings-search-empty">
              没有匹配「{query.trim()}」的设置
            </p>
          ) : (
            groups.map((group) => (
              <div
                key={group.id}
                className="flex flex-col gap-1"
                data-testid={`settings-group-${group.id}`}
              >
                <p className="px-2 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
                  {group.title}
                </p>
                <ul className="flex flex-col gap-0.5">
                  {group.sections.map((section) => {
                    const Icon = section.icon;
                    const isActive = active?.id === section.id;
                    return (
                      <li key={section.id}>
                        <button
                          type="button"
                          onClick={() => openSection(section.id)}
                          aria-current={isActive ? 'page' : undefined}
                          className={cn(
                            'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm transition-colors',
                            isActive
                              ? 'bg-accent font-medium text-foreground'
                              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                          )}
                          data-testid={`settings-nav-${section.id}`}
                        >
                          <Icon className="size-4 shrink-0" aria-hidden />
                          <span className="flex-1 truncate">{section.title}</span>
                          <ChevronRight
                            className="size-4 shrink-0 text-muted-foreground md:hidden"
                            aria-hidden
                          />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </nav>

        {/* 分区面板:md+ 常驻;移动端进入二级后显示,带返回。 */}
        {active ? (
          <section
            aria-labelledby={`settings-section-title-${active.id}`}
            className={cn(
              'flex min-w-0 flex-col gap-6 rounded-xl transition-shadow duration-(--dur-base)',
              mobilePanelOpen ? 'flex' : 'hidden md:flex',
              highlight && 'ring-2 ring-primary/40 ring-offset-2 ring-offset-background',
            )}
            data-testid={`settings-section-${active.id}`}
          >
            {/* 面板头只在移动端出现(返回 + 标题定位);md+ 由各卡片自述,避免与卡片头重复。 */}
            <div className="flex items-center gap-1 md:hidden">
              <Button
                variant="ghost"
                size="icon"
                className="-ml-2 size-8 shrink-0"
                aria-label="返回设置列表"
                onClick={() => setMobilePanelOpen(false)}
                data-testid="settings-section-back"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <h2
                id={`settings-section-title-${active.id}`}
                className="flex min-w-0 items-center gap-2 truncate font-medium text-base text-foreground"
              >
                {ActiveIcon ? (
                  <ActiveIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                ) : null}
                {active.title}
              </h2>
            </div>
            {active.render(context)}
          </section>
        ) : null}
      </div>
    </div>
  );
}
