import { describe, expect, it } from 'vitest';
import { PRODUCT_SHORTCUTS, shortcutDisplay } from '../shortcuts';

/**
 * 「只列真实接线」硬规则(00 法则 6,07-settings-07 §2.4):
 * WIRED 是接线状态的显式镜像 —— 新增快捷键必须先接线再登记,
 * 提前上表(表里有、镜像没有)或忘记上表(镜像有、表里没有)都会红。
 * 改这个集合前,先确认 wiredAt 指向的代码坐标真实存在按键处理。
 */
const WIRED = [
  'new-session',
  'composer-send',
  'composer-newline',
  'prompts-search',
  'prompts-focus-search',
  'prompt-editor-save',
  'open-settings',
  'dismiss',
] as const;

/**
 * 接线坐标必须指到真实按键处理处。features 禁 Node 内置(depcruise),
 * 读不了源码文件核对,只能在这里把坐标钉死为常量 —— 挪走接线必须同步改这张表。
 */
const WIRED_AT: Record<(typeof WIRED)[number], string> = {
  'new-session': 'workbench/SessionListPanel NewSessionAction keydown',
  'composer-send': 'workbench/Composer Textarea onKeyDown',
  'composer-newline': 'workbench/Composer Textarea onKeyDown',
  'prompts-search': 'shell/AppShell ⌘K keydown → screen-intent prompts-focus-search',
  'prompts-focus-search': 'prompts/PromptLibraryScreen 非输入态 "/" keydown',
  'prompt-editor-save': 'prompts/PromptEditorDialog DialogContent onKeyDown',
  'open-settings': 'shell/AppShell ⌘, keydown → onNavigate(settings)',
  dismiss: 'Radix Dialog/Menu 内建 + SessionListPanel/HistoryRow 行内编辑 onKeyDown',
};

describe('产品快捷键单源(C-2)', () => {
  it('表内条目与接线镜像一一对应,不多不少', () => {
    expect(PRODUCT_SHORTCUTS.map((item) => item.id).sort()).toEqual([...WIRED].sort());
  });

  it('每条都带接线坐标与作用域,Enter 系标注输入框作用域', () => {
    for (const shortcut of PRODUCT_SHORTCUTS) {
      expect(shortcut.wiredAt.length, shortcut.id).toBeGreaterThan(0);
      expect(shortcut.scope.length, shortcut.id).toBeGreaterThan(0);
      expect(shortcut.label.length, shortcut.id).toBeGreaterThan(0);
    }
    expect(PRODUCT_SHORTCUTS.find((s) => s.id === 'composer-send')?.scope).toContain('输入框');
    expect(PRODUCT_SHORTCUTS.find((s) => s.id === 'composer-newline')?.scope).toContain('输入框');
  });

  it('表内条目均已接线:wiredAt 与接线坐标镜像逐条一致', () => {
    for (const shortcut of PRODUCT_SHORTCUTS) {
      expect(shortcut.wiredAt, shortcut.id).toBe(WIRED_AT[shortcut.id]);
    }
  });

  it('提示词域三条快捷键作用域标注正确(全局 / 屏内 / 编辑器内)', () => {
    const byId = (id: string) => PRODUCT_SHORTCUTS.find((s) => s.id === id);
    expect(byId('prompts-search')?.scope).toContain('全局');
    expect(byId('prompts-focus-search')?.scope).toContain('非输入态');
    expect(byId('prompt-editor-save')?.scope).toContain('未保存');
  });

  it('平台化显示:mac 用 ⌘ 系,win 用 Ctrl 系,未知 id 返回空串', () => {
    expect(shortcutDisplay('new-session', true)).toBe('⌘N');
    expect(shortcutDisplay('new-session', false)).toBe('Ctrl+N');
    expect(shortcutDisplay('composer-send', true)).toBe('Enter');
    expect(shortcutDisplay('prompts-search', true)).toBe('⌘K');
    expect(shortcutDisplay('prompts-search', false)).toBe('Ctrl+K');
    expect(shortcutDisplay('prompt-editor-save', true)).toBe('⌘S');
    expect(shortcutDisplay('prompt-editor-save', false)).toBe('Ctrl+S');
    // 无修饰键的单键在两个平台同形。
    expect(shortcutDisplay('prompts-focus-search', true)).toBe('/');
    expect(shortcutDisplay('prompts-focus-search', false)).toBe('/');
    // @ts-expect-error 越界 id 防御:返回空串不抛错
    expect(shortcutDisplay('not-wired', true)).toBe('');
  });
});
