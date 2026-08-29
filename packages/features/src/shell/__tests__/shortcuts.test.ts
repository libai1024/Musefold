import { describe, expect, it } from 'vitest';
import { PRODUCT_SHORTCUTS, shortcutDisplay } from '../shortcuts';

/**
 * 「只列真实接线」硬规则(00 法则 6,07-settings-07 §2.4):
 * WIRED 是接线状态的显式镜像 —— 新增快捷键必须先接线再登记,
 * 提前上表(表里有、镜像没有)或忘记上表(镜像有、表里没有)都会红。
 * 改这个集合前,先确认 wiredAt 指向的代码坐标真实存在按键处理。
 */
const WIRED = ['new-session', 'composer-send', 'composer-newline', 'dismiss'] as const;

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

  it('平台化显示:mac 用 ⌘ 系,win 用 Ctrl 系,未知 id 返回空串', () => {
    expect(shortcutDisplay('new-session', true)).toBe('⌘N');
    expect(shortcutDisplay('new-session', false)).toBe('Ctrl+N');
    expect(shortcutDisplay('composer-send', true)).toBe('Enter');
    // @ts-expect-error 越界 id 防御:返回空串不抛错
    expect(shortcutDisplay('not-wired', true)).toBe('');
  });
});
