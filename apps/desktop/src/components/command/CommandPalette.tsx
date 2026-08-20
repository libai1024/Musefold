// src/components/command/CommandPalette.tsx
// ⌘K 命令面板 —— macOS 26 / Codex 招牌交互
// 导航 + 全局动作 + 提示词即时检索，键盘全程可达
// 详见 docs/06-ui-design-system.md §7

import { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  LibraryBig,
  Blocks,
  History,
  SquarePen,
  Package,
  Sun,
  Moon,
  PanelLeft,
  Search,
  CornerDownLeft,
  FileText,
  Settings2,
  Server,
  MessageSquareText,
} from '../ui/icons';
import { useAppStore, type ViewKey } from '../../stores/app';
import { useLibraryStore } from '../../features/library/store';
import { useSettingsStore } from '../../features/settings/store';
import { Kbd } from '@musefold/ui';
import { cn } from '../../lib/utils';
import { useGenerationWorkbenchStore } from '../../features/generation/workbench/store';
import {
  COMMAND_ACTION_CAPABILITY,
  isCapabilityEntryVisible,
} from '../../runtime/capabilities';

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
  const sessions = useGenerationWorkbenchStore((s) => s.sessions);
  const loadSessions = useGenerationWorkbenchStore((s) => s.loadSessions);
  const openSession = useGenerationWorkbenchStore((s) => s.openSession);
  const openDraft = useGenerationWorkbenchStore((s) => s.openDraft);

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 全局快捷键：⌘K / Ctrl+K 开合面板；⌘N / Ctrl+N 新设计（Codex 开新对话）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'k') {
        e.preventDefault();
        useAppStore.getState().toggleCommand();
      } else if (key === 'n') {
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

  const actions = useMemo<CommandAction[]>(
    () => [
      // 快速动作（Codex ⌘K：一开就有下一步）
      { id: 'act-new-conversation', label: '新设计', hint: '开一条新的设计对话（⌘N）', group: '快速动作', icon: SquarePen, keywords: 'new conversation chat design xin sheji duihua', run: () => { newConversation(); setOpen(false); } },
      { id: 'act-import-skill', label: '用 Skill 创建设计方案', hint: '粘贴 GitHub Skill 地址', group: '快速动作', icon: Package, keywords: 'skill import daoru github design scheme', run: () => { const workbench = useGenerationWorkbenchStore.getState(); workbench.newSession(); workbench.setDraftCommand('design-plan'); go('generate'); } },
      // 导航：制作工作台不设导航项——「新设计」或对话列表即入口（Codex 逻辑）
      { id: 'nav-library', label: '提示词库', hint: '浏览与管理', group: '导航', icon: LibraryBig, keywords: 'library prompt tkck', run: () => go('library') },
      { id: 'nav-design-schemes', label: '设计方案', hint: '创建、探索与运行', group: '导航', icon: Blocks, keywords: 'design scheme agent skill sheji fang an', run: () => go('design-schemes') },
      { id: 'nav-history', label: '生成历史', hint: '生图记录', group: '导航', icon: History, keywords: 'history lishi', run: () => go('history') },
      { id: 'nav-settings', label: '设置', hint: '服务商 · 生成 · 外观', group: '导航', icon: Settings2, keywords: 'settings preferences shezhi peizhi', run: () => go('settings') },
      {
        id: 'act-providers',
        label: '管理生图模型',
        hint: '生图接入 / 密钥 / 测试连接',
        group: '操作',
        icon: Server,
        keywords: 'provider api key fuwushang moxing',
        run: () => { setSettingsSection('providers'); go('settings'); },
      },
      {
        id: 'act-ai-connections',
        label: '管理 Agent 模型',
        hint: '文本模型 / 密钥 / 能力检测',
        group: '操作',
        icon: MessageSquareText,
        keywords: 'ai agent assistant api key text model design',
        run: () => { setSettingsSection('ai'); go('settings'); },
      },
      {
        id: 'act-theme',
        label: theme === 'dark' ? '切换到浅色' : '切换到深色',
        group: '操作',
        icon: theme === 'dark' ? Sun : Moon,
        keywords: 'theme dark light zhuti',
        run: () => { toggleTheme(); setOpen(false); },
      },
      {
        id: 'act-sidebar',
        label: '折叠 / 展开侧栏',
        group: '操作',
        icon: PanelLeft,
        keywords: 'sidebar collapse cebian',
        run: () => { toggleSidebar(); setOpen(false); },
      },
    ].filter((action) => isCapabilityEntryVisible(COMMAND_ACTION_CAPABILITY, action.id)),
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
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/45 animate-overlay-in" />
        <Dialog.Content
          onKeyDown={onListKey}
          className="no-drag fixed left-1/2 top-[18%] z-[101] max-h-[calc(100vh-96px)] w-[calc(100vw-32px)] max-w-[560px] -translate-x-1/2 overflow-hidden rounded-lg border border-border-default bg-popover shadow-pop animate-command-in max-[640px]:top-16"
          aria-label="命令面板"
        >
          <Dialog.Title className="sr-only">命令面板</Dialog.Title>
          <Dialog.Description className="sr-only">搜索导航、操作与提示词</Dialog.Description>

          {/* 搜索行 */}
          <div className="flex items-center gap-2.5 border-b border-border-subtle px-3.5 py-3">
            <Search className="h-4 w-4 shrink-0 text-tertiary" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              placeholder="搜索命令、对话或提示词…"
              className="flex-1 bg-transparent text-sm text-primary placeholder:text-tertiary focus:outline-none"
            />
            <Kbd>ESC</Kbd>
          </div>

          {/* 结果 */}
          <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-1.5">
            {flat.length === 0 && (
              <div className="flex flex-col items-center gap-1 py-10 text-tertiary">
                <Search className="h-5 w-5" />
                <p className="text-xs">没有匹配结果</p>
              </div>
            )}

            {filteredActions.length > 0 && (
              <Group label="命令">
                {filteredActions.map((a) => {
                  const idx = indexOf();
                  return (
                    <Row
                      key={a.id}
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

          {/* 底栏提示 */}
          <div className="flex items-center justify-between border-t border-border-subtle bg-inset/40 px-3.5 py-2 text-[10px] text-tertiary">
            <span className="flex items-center gap-1.5">
              <Kbd>↑</Kbd><Kbd>↓</Kbd> 移动
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd><CornerDownLeft className="h-2.5 w-2.5" /></Kbd> 选择
            </span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-1">
      <div className="px-2.5 pb-1 pt-1.5 text-[10px] font-medium text-tertiary">
        {label}
      </div>
      {children}
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  hint,
  group,
  active,
  onMouseEnter,
  onClick,
}: {
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
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors duration-[var(--dur-instant)]',
        active ? 'bg-accent-soft text-accent' : 'text-secondary'
      )}
    >
      <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-accent' : 'text-tertiary')} />
      <span className={cn('flex-1 truncate text-[13px]', active ? 'text-primary' : 'text-primary')}>
        {label}
      </span>
      {hint && <span className="truncate text-[11px] text-tertiary">{hint}</span>}
      {group && (
        <span className="rounded-sm border border-border-subtle px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-quaternary">
          {group}
        </span>
      )}
    </button>
  );
}
