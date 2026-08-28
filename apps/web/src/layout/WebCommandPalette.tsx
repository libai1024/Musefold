// Web 大屏命令面板（v2.1 parity A）。
// 复用 domain 命令目录（visibleProductCommands）与 product-ui 的
// productCommandIcon / productCommandLabel；会话与提示词命中由 Web 宿主注入
// （sessions 来自共享 generate controller，prompts 来自 library query 缓存）。
// 交互基线与桌面 CommandPalette 对齐：⌘K 开合、上下键 + Enter、Esc 关闭。

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PromptDocument } from '@musefold/contracts';
import {
  matchProductModifierShortcut,
  visibleProductCommands,
  type ProductCapabilities,
  type ProductCommandSpec,
} from '@musefold/domain';
import {
  productCommandIcon,
  productCommandLabel,
  type WorkbenchSessionListItemViewModel,
} from '@musefold/product-ui';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@musefold/ui';
import { FileText, MessageSquareText, Search } from '@musefold/ui/icons';
import type { WebView } from './WebNavigation';

/** 命令目录的 navigate 值 → Web 视图键（Web 侧栏 id 保持 prompts）。 */
export function webCommandTargetView(navigate: string | undefined): WebView {
  if (navigate === 'library' || navigate === 'prompts') return 'prompts';
  if (navigate === 'history') return 'history';
  if (navigate === 'settings') return 'settings';
  return 'generate';
}

// Web 命令目录不含主题切换项；标签经共享 productCommandLabel 走同一渲染路径。
const WEB_PALETTE_THEME = 'light' as const;

export interface WebCommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  capabilities: Readonly<ProductCapabilities>;
  sessions: readonly WorkbenchSessionListItemViewModel[];
  prompts: readonly PromptDocument[];
  onNewDesign: () => void;
  onNavigate: (view: WebView) => void;
  onOpenSession: (sessionId: string) => void;
  onUsePrompt: (prompt: PromptDocument) => void;
}

interface PaletteRow {
  id: string;
  kind: 'command' | 'session' | 'prompt';
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint?: string;
  group?: string;
  run: () => void;
}

export function WebCommandPalette({
  open,
  onOpenChange,
  capabilities,
  sessions,
  prompts,
  onNewDesign,
  onNavigate,
  onOpenSession,
  onUsePrompt,
}: WebCommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);
  openRef.current = open;

  // 全局快捷键：⌘K / Ctrl+K 开合面板。Web 不占用 ⌘N（浏览器保留新窗口）。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (matchProductModifierShortcut(event) !== 'command-palette') return;
      event.preventDefault();
      onOpenChange(!openRef.current);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onOpenChange]);

  // 打开时重置并聚焦。
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const close = () => onOpenChange(false);

  const runSpec = (spec: ProductCommandSpec) => {
    switch (spec.action) {
      case 'new-design':
        onNewDesign();
        close();
        return;
      case 'navigate':
      case 'settings':
        onNavigate(webCommandTargetView(spec.navigate ?? spec.settingsSection));
        close();
        return;
      default:
        return;
    }
  };

  const rows = useMemo<PaletteRow[]>(() => {
    const q = query.trim().toLowerCase();
    const items: PaletteRow[] = [];

    const commands = visibleProductCommands('web', capabilities).filter((spec) => {
      if (!q) return spec.group === '快速动作';
      return (
        spec.label.toLowerCase().includes(q) ||
        spec.keywords?.toLowerCase().includes(q) ||
        spec.group.toLowerCase().includes(q)
      );
    });
    commands.forEach((spec) =>
      items.push({
        id: spec.id,
        kind: 'command',
        icon: productCommandIcon(spec.id, WEB_PALETTE_THEME),
        label: productCommandLabel(spec, WEB_PALETTE_THEME),
        hint: spec.hint,
        group: spec.group,
        run: () => runSpec(spec),
      }),
    );

    sessions
      .filter((session) => !q || session.title.toLowerCase().includes(q))
      .slice(0, q ? 6 : 3)
      .forEach((session) =>
        items.push({
          id: session.id,
          kind: 'session',
          icon: MessageSquareText,
          label: session.title,
          hint: session.status === 'running' ? '生成中' : undefined,
          run: () => {
            onOpenSession(session.id);
            close();
          },
        }),
      );

    if (q) {
      prompts
        .filter(
          (prompt) =>
            prompt.title.toLowerCase().includes(q) ||
            prompt.content.toLowerCase().includes(q) ||
            prompt.description?.toLowerCase().includes(q),
        )
        .slice(0, 6)
        .forEach((prompt) =>
          items.push({
            id: prompt.id,
            kind: 'prompt',
            icon: FileText,
            label: prompt.title,
            hint: prompt.modelId ?? undefined,
            run: () => {
              onUsePrompt(prompt);
              close();
            },
          }),
        );
    }

    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capabilities, onNavigate, onOpenSession, onUsePrompt, prompts, query, sessions]);

  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(0, rows.length - 1)));
  }, [rows.length]);

  useEffect(() => {
    if (!open || rows.length === 0) return;
    listRef.current
      ?.querySelector<HTMLElement>(`#web-command-option-${active}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, open, rows.length]);

  const onListKey = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => (current + 1) % Math.max(1, rows.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => (current - 1 + rows.length) % Math.max(1, rows.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      rows[active]?.run();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="web-command-panel"
        hideClose
        aria-label="命令面板"
        data-testid="web-command-palette"
        onKeyDown={onListKey}
      >
        <DialogTitle className="sr-only">命令面板</DialogTitle>
        <DialogDescription className="sr-only">搜索导航、操作与提示词</DialogDescription>
        <div className="web-command-search">
          <Search aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            placeholder="搜索命令、对话或提示词…"
            aria-label="搜索 Musefold"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls="web-command-results"
            aria-activedescendant={
              rows.length > 0 ? `web-command-option-${active}` : undefined
            }
            data-testid="web-command-input"
          />
        </div>
        <div
          ref={listRef}
          id="web-command-results"
          className="web-command-list"
          role="listbox"
          aria-label="Musefold 命令与搜索结果"
        >
          {rows.length === 0 && (
            <div className="web-command-empty">
              <Search className="web-command-empty-icon" aria-hidden="true" />
              <p>没有匹配结果</p>
            </div>
          )}
          {renderGroup(rows, 'command', '命令', active, setActive)}
          {renderGroup(rows, 'session', '最近对话', active, setActive)}
          {renderGroup(rows, 'prompt', '提示词', active, setActive)}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function renderGroup(
  rows: readonly PaletteRow[],
  kind: PaletteRow['kind'],
  label: string,
  active: number,
  setActive: (index: number) => void,
) {
  const groupRows = rows.filter((row) => row.kind === kind);
  if (groupRows.length === 0) return null;
  return (
    <div className="web-command-group">
      <div className="web-command-group-label">{label}</div>
      {groupRows.map((row) => {
        const index = rows.indexOf(row);
        return (
          <button
            key={row.id}
            id={`web-command-option-${index}`}
            type="button"
            role="option"
            aria-selected={index === active}
            tabIndex={-1}
            className="web-command-row"
            data-active={index === active || undefined}
            data-kind={row.kind}
            onMouseEnter={() => setActive(index)}
            onClick={row.run}
          >
            <row.icon className="web-command-row-icon" aria-hidden="true" />
            <span className="web-command-row-label">{row.label}</span>
            {row.hint && <span className="web-command-row-hint">{row.hint}</span>}
            {row.group && <span className="web-command-row-group">{row.group}</span>}
          </button>
        );
      })}
    </div>
  );
}
