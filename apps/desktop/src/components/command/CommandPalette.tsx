// src/components/command/CommandPalette.tsx
// ⌘K 命令面板 —— macOS 26 / Codex 招牌交互
// 导航 + 全局动作 + 提示词即时检索，键盘全程可达
// 详见 docs/06-ui-design-system.md §7

import { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Search,
  FileText,
  MessageSquareText,
} from '../ui/icons';
import { useAppStore, type ViewKey } from '../../stores/app';
import { useLibraryStore } from '../../features/library/store';
import { useSettingsStore, type SettingsSectionInput } from '../../features/settings/store';
import { useGenerationWorkbenchStore } from '../../features/generation/workbench/store';
import { useDesktopWorkbenchSessionList } from '../../features/generation/workbench/workbench-session-query';
import { capabilities } from '../../runtime/capabilities';
import {
  matchProductModifierShortcut,
  visibleProductCommands,
  type ProductCommandSpec,
} from '@musefold/domain';
import { productCommandIcon, productCommandLabel } from '@musefold/product-ui';

interface CommandAction {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon: React.ComponentType<{ className?: string }>;
  keywords?: string;
  run: () => void;
}

export function CommandPalette() {
  const open = useAppStore((s) => s.commandOpen);
  const setOpen = useAppStore((s) => s.setCommandOpen);
  const setView = useAppStore((s) => s.setView);
  const newConversation = useAppStore((s) => s.newConversation);
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);

  const prompts = useLibraryStore((s) => s.prompts);
  const setSettingsSection = useSettingsStore((s) => s.setSection);
  const { sessions } = useDesktopWorkbenchSessionList();
  const loadSessions = useGenerationWorkbenchStore((s) => s.loadSessions);
  const openSession = useGenerationWorkbenchStore((s) => s.openSession);
  const openDraft = useGenerationWorkbenchStore((s) => s.openDraft);

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 全局快捷键：⌘K / Ctrl+K 开合面板；⌘N / Ctrl+N 新设计（共享 shortcut 目录）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const match = matchProductModifierShortcut(e);
      if (match === 'command-palette') {
        e.preventDefault();
        useAppStore.getState().toggleCommand();
      } else if (match === 'new-design') {
        e.preventDefault();
        useAppStore.getState().newConversation();
        useAppStore.getState().setCommandOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 打开时重置并聚焦
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      void loadSessions();
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [loadSessions, open]);

  const go = (view: ViewKey) => {
    setView(view);
    setOpen(false);
  };

  const runCommand = (spec: ProductCommandSpec) => {
    switch (spec.action) {
      case 'new-design':
        newConversation();
        setOpen(false);
        return;
      case 'import-skill': {
        const workbench = useGenerationWorkbenchStore.getState();
        workbench.newSession();
        workbench.setDraftCommand('design-plan');
        go('generate');
        return;
      }
      case 'navigate':
        if (spec.navigate) go(spec.navigate as ViewKey);
        return;
      case 'settings':
        if (spec.settingsSection) setSettingsSection(spec.settingsSection as SettingsSectionInput);
        go((spec.navigate ?? 'settings') as ViewKey);
        return;
      case 'toggle-theme':
        toggleTheme();
        setOpen(false);
        return;
      case 'toggle-sidebar':
        toggleSidebar();
        setOpen(false);
    }
  };

  const actions = useMemo<CommandAction[]>(
    () =>
      visibleProductCommands('desktop', capabilities).map((spec) => ({
        id: spec.id,
        label: productCommandLabel(spec, theme),
        hint: spec.hint,
        group: spec.group,
        icon: productCommandIcon(spec.id, theme),
        keywords: spec.keywords,
        run: () => runCommand(spec),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme]
  );

  const q = query.trim().toLowerCase();

  const filteredActions = useMemo(() => {
    if (!q) return actions.filter((action) => action.group === '快速动作');
    return actions.filter(
      (a) =>
        a.label.toLowerCase().includes(q) ||
        a.keywords?.toLowerCase().includes(q) ||
        a.group.toLowerCase().includes(q)
    );
  }, [actions, q]);

  const promptHits = useMemo(() => {
    if (!q) return [];
    return prompts
      .filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.content.toLowerCase().includes(q) ||
          p.description?.toLowerCase().includes(q)
      )
      .slice(0, 6);
  }, [prompts, q]);

  const sessionHits = useMemo(() => sessions
    .filter((session) => !q || session.title.toLowerCase().includes(q))
    .slice(0, q ? 6 : 3), [q, sessions]);

  // 扁平化：动作、对话、提示词共享同一套键盘索引。
  const flat = useMemo(() => {
    const items: { type: 'action' | 'session' | 'prompt'; id: string; run: () => void }[] = [];
    filteredActions.forEach((a) => items.push({ type: 'action', id: a.id, run: a.run }));
    sessionHits.forEach((session) => items.push({
      type: 'session',
      id: session.id,
      run: () => {
        void openSession(session.id);
        setOpen(false);
      },
    }));
    promptHits.forEach((p) =>
      items.push({
        type: 'prompt',
        id: p.id,
        run: () => {
          openDraft({
            prompt: p.content,
            negative: p.contentNegative ?? '',
            source: { kind: 'prompt', id: p.id, label: p.title },
          });
          setOpen(false);
        },
      })
    );
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredActions, openDraft, openSession, promptHits, sessionHits, setOpen]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, flat.length - 1)));
  }, [flat.length]);

  useEffect(() => {
    if (!open || flat.length === 0) return;
    listRef.current
      ?.querySelector<HTMLElement>(`#mf-command-option-${active}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, flat.length, open]);

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (a + 1) % Math.max(1, flat.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a - 1 + flat.length) % Math.max(1, flat.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      flat[active]?.run();
    }
  };

  // 分组渲染时计算全局索引
  let runningIndex = -1;
  const indexOf = () => (runningIndex += 1);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="mf-command-overlay animate-overlay-in" />
        <Dialog.Content
          onKeyDown={onListKey}
          className="mf-command-panel no-drag animate-command-in"
          aria-label="命令面板"
          data-testid="command-palette"
        >
          <Dialog.Title className="sr-only">命令面板</Dialog.Title>
          <Dialog.Description className="sr-only">搜索导航、操作与提示词</Dialog.Description>

          {/* 搜索行 */}
          <div className="mf-command-search">
            <Search aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              placeholder="搜索命令、对话或提示词…"
              aria-label="搜索 Musefold"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={open}
              aria-controls="mf-command-results"
              aria-activedescendant={flat.length > 0 ? `mf-command-option-${active}` : undefined}
            />
          </div>

          {/* 结果 */}
          <div
            ref={listRef}
            id="mf-command-results"
            className="mf-command-list"
            role="listbox"
            aria-label="Musefold 命令与搜索结果"
          >
            {flat.length === 0 && (
              <div className="mf-command-empty">
                <Search className="h-5 w-5" />
                <p>没有匹配结果</p>
              </div>
            )}

            {filteredActions.length > 0 && (
              <Group label="命令">
                {filteredActions.map((a) => {
                  const idx = indexOf();
                  return (
                    <Row
                      key={a.id}
                      optionId={`mf-command-option-${idx}`}
                      icon={a.icon}
                      label={a.label}
                      hint={a.hint}
                      group={a.group}
                      active={idx === active}
                      onMouseEnter={() => setActive(idx)}
                      onClick={a.run}
                    />
                  );
                })}
              </Group>
            )}

            {sessionHits.length > 0 && (
              <Group label="最近对话">
                {sessionHits.map((session) => {
                  const idx = indexOf();
                  return (
                    <Row
                      key={session.id}
                      optionId={`mf-command-option-${idx}`}
                      icon={MessageSquareText}
                      label={session.title}
                      hint={`${session.turnCount} 个回合`}
                      active={idx === active}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => {
                        void openSession(session.id);
                        setOpen(false);
                      }}
                    />
                  );
                })}
              </Group>
            )}

            {promptHits.length > 0 && (
              <Group label="提示词">
                {promptHits.map((p) => {
                  const idx = indexOf();
                  return (
                    <Row
                      key={p.id}
                      optionId={`mf-command-option-${idx}`}
                      icon={FileText}
                      label={p.title}
                      hint={p.modelId ?? undefined}
                      active={idx === active}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => {
                        openDraft({
                          prompt: p.content,
                          negative: p.contentNegative ?? '',
                          source: { kind: 'prompt', id: p.id, label: p.title },
                        });
                        setOpen(false);
                      }}
                    />
                  );
                })}
              </Group>
            )}
          </div>

        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mf-command-group">
      <div className="mf-command-group-label">{label}</div>
      {children}
    </div>
  );
}

function Row({
  optionId,
  icon: Icon,
  label,
  hint,
  group,
  active,
  onMouseEnter,
  onClick,
}: {
  optionId: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint?: string;
  group?: string;
  active: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
}) {
  return (
    <button
      id={optionId}
      type="button"
      role="option"
      aria-selected={active}
      tabIndex={-1}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      className="mf-command-row"
      data-active={active || undefined}
    >
      <Icon />
      <span className="mf-command-row-label">{label}</span>
      {hint && <span className="mf-command-row-hint">{hint}</span>}
      {group && (
        <span className="mf-command-row-group">{group}</span>
      )}
    </button>
  );
}
