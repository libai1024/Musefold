import { describe, expect, it } from 'vitest';
import {
  SHELL_SIDEBAR_DEFAULT_WIDTH,
  SHELL_SIDEBAR_MAX_WIDTH,
  SHELL_SIDEBAR_MIN_WIDTH,
  SHELL_SIDEBAR_COMPACT_BREAKPOINT,
  SHELL_SIDEBAR_WIDTH_STORAGE_KEY,
  clampSidebarWidth,
  readStoredSidebarWidth,
  resolveSidebarMaxWidth,
  writeStoredSidebarWidth,
} from '../sidebar-layout';

/**
 * 测试注入内存 Storage(根 vitest 以 node 环境收集本文件,且 Node 25 自带的
 * 残废 localStorage 全局会遮蔽 jsdom 实现 —— 用例一律不碰 window.localStorage)。
 */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
}

describe('sidebar-layout 几何(承旧 ProductSidebarLayout,ui-parity 01 §2.1)', () => {
  it('compact 与 Tailwind md 在 767/768px 无缝衔接', () => {
    expect(SHELL_SIDEBAR_COMPACT_BREAKPOINT).toBe(767);
    expect(`(max-width: ${SHELL_SIDEBAR_COMPACT_BREAKPOINT}px)`).toBe('(max-width: 767px)');
  });

  it('最大宽度:min(360, 32vw),且永不低于最小值', () => {
    // 超宽窗口:32vw 超过 360 → 静态上限生效。
    expect(resolveSidebarMaxWidth(2000)).toBe(SHELL_SIDEBAR_MAX_WIDTH);
    // 1125px 是 360 与 32vw 的交点:32vw = 360。
    expect(resolveSidebarMaxWidth(1125)).toBe(360);
    // 窄窗口:32vw 收紧到 360 以下。
    expect(resolveSidebarMaxWidth(1000)).toBe(320);
    // 极窄窗口(32vw 跌破 220):最小值兜底,手柄永远有可用区间。
    expect(resolveSidebarMaxWidth(600)).toBe(SHELL_SIDEBAR_MIN_WIDTH);
  });

  it('clamp:越界收回 [220, max],非有限数回落默认 248', () => {
    expect(clampSidebarWidth(100, 360)).toBe(SHELL_SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(999, 360)).toBe(360);
    expect(clampSidebarWidth(300.6, 360)).toBe(301);
    expect(clampSidebarWidth(Number.NaN, 360)).toBe(SHELL_SIDEBAR_DEFAULT_WIDTH);
    expect(clampSidebarWidth(Number.POSITIVE_INFINITY, 360)).toBe(SHELL_SIDEBAR_DEFAULT_WIDTH);
  });
});

describe('sidebar-layout 宽度存档(localStorage 承旧键 musefold:sidebar-width)', () => {
  it('无存档/非法存档返回 null,调用方回落默认值', () => {
    const storage = new MemoryStorage();
    expect(readStoredSidebarWidth(storage, 1440)).toBeNull();
    storage.setItem(SHELL_SIDEBAR_WIDTH_STORAGE_KEY, 'not-a-number');
    expect(readStoredSidebarWidth(storage, 1440)).toBeNull();
  });

  it('正常存档读出;历史越界值 clamp 回区间', () => {
    const storage = new MemoryStorage();
    storage.setItem(SHELL_SIDEBAR_WIDTH_STORAGE_KEY, '300');
    expect(readStoredSidebarWidth(storage, 1440)).toBe(300);
    // 旧版 200–219px 历史值统一收回 220(v2.0 §B2 承旧)。
    storage.setItem(SHELL_SIDEBAR_WIDTH_STORAGE_KEY, '205');
    expect(readStoredSidebarWidth(storage, 1440)).toBe(SHELL_SIDEBAR_MIN_WIDTH);
    // 超出当前视口 32vw 上限的存档按视口夹取。
    storage.setItem(SHELL_SIDEBAR_WIDTH_STORAGE_KEY, '360');
    expect(readStoredSidebarWidth(storage, 1000)).toBe(320);
  });

  it('写入后可读回;存储不可用时读写都安全回退', () => {
    const storage = new MemoryStorage();
    writeStoredSidebarWidth(storage, 280);
    expect(readStoredSidebarWidth(storage, 1440)).toBe(280);

    expect(readStoredSidebarWidth(null, 1440)).toBeNull();
    expect(() => writeStoredSidebarWidth(null, 280)).not.toThrow();
    // 访问即抛的存储(禁用 DOM Storage 的隐私模式)不炸壳。
    const hostile = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    } as unknown as Storage;
    expect(readStoredSidebarWidth(hostile, 1440)).toBeNull();
    expect(() => writeStoredSidebarWidth(hostile, 280)).not.toThrow();
  });
});
