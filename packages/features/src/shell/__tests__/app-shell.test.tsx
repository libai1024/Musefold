import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../AppShell';
import type { ShellNavItem } from '../nav';
import {
  SHELL_SIDEBAR_DEFAULT_WIDTH,
  SHELL_SIDEBAR_MIN_WIDTH,
  SHELL_SIDEBAR_WIDTH_STORAGE_KEY,
} from '../sidebar-layout';

/** 可控 matchMedia:jsdom 无原生实现;支持用例中途切换断点(响应式可达性)。 */
function stubMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const stub = vi.fn().mockImplementation((query: string) => ({
    get matches() {
      return matches;
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, cb: (event: MediaQueryListEvent) => void) =>
      listeners.add(cb),
    removeEventListener: (_type: string, cb: (event: MediaQueryListEvent) => void) =>
      listeners.delete(cb),
    addListener: (cb: (event: MediaQueryListEvent) => void) => listeners.add(cb),
    removeListener: (cb: (event: MediaQueryListEvent) => void) => listeners.delete(cb),
    dispatchEvent: () => false,
  }));
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: stub,
  });
  return {
    setMatches(next: boolean) {
      matches = next;
      act(() => {
        for (const cb of listeners) cb({ matches } as MediaQueryListEvent);
      });
    },
  };
}

/** Node 25 自带的残废 localStorage 全局会遮蔽 jsdom 实现,换成内存 Storage。 */
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

function stubLocalStorage() {
  Object.defineProperty(window, 'localStorage', {
    writable: true,
    configurable: true,
    value: new MemoryStorage(),
  });
}

function setInnerWidth(px: number) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: px });
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
}

/** React 19 按环境能力以属性或特性方式落 inert,断言两态兼容。 */
function isInert(el: HTMLElement): boolean {
  return el.hasAttribute('inert') || (el as HTMLElement & { inert?: boolean }).inert === true;
}

interface HarnessProps {
  activeId?: ShellNavItem['id'] | null;
  onNavigate?: (id: ShellNavItem['id']) => void;
  brandInset?: number;
  children?: ReactNode;
}

function Harness({
  activeId = 'workbench',
  onNavigate = vi.fn(),
  brandInset,
  children,
}: HarnessProps) {
  return (
    <AppShell
      activeId={activeId}
      onNavigate={onNavigate}
      brandInset={brandInset}
      action={
        <button type="button" data-testid="session-create">
          新设计
        </button>
      }
      sessions={
        <div data-testid="session-panel">
          <button type="button" data-testid="session-abc123">
            会话 A
          </button>
          <button type="button" data-testid="session-pin">
            置顶
          </button>
        </div>
      }
      footer={
        <button type="button" data-testid="account-footer">
          账号
        </button>
      }
    >
      {children ?? <p data-testid="main-content">主区</p>}
    </AppShell>
  );
}

describe('AppShell 侧栏拖宽(ui-parity 01 §7 P1,承旧 ProductSidebarLayout)', () => {
  beforeEach(() => {
    stubMatchMedia(false);
    setInnerWidth(1440);
    stubLocalStorage();
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('默认宽度 248px;手柄带 separator 语义(aria-valuemin/max/now)', () => {
    render(<Harness />);
    const sidebar = screen.getByTestId('app-sidebar');
    expect(sidebar.style.width).toBe(`${SHELL_SIDEBAR_DEFAULT_WIDTH}px`);
    const handle = screen.getByTestId('sidebar-resize-handle');
    expect(handle.getAttribute('role')).toBe('separator');
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle.getAttribute('aria-valuemin')).toBe(String(SHELL_SIDEBAR_MIN_WIDTH));
    expect(handle.getAttribute('aria-valuemax')).toBe('360');
    expect(handle.getAttribute('aria-valuenow')).toBe(String(SHELL_SIDEBAR_DEFAULT_WIDTH));
  });

  it('普通屏使用四边 4px 浮岛,设置屏保持全出血工作区', () => {
    const { rerender } = render(<Harness activeId="workbench" />);
    expect(screen.getByTestId('mainview-frame').className).toContain('md:p-1');
    expect(screen.getByTestId('mainview-surface').className).toContain('md:rounded-xl');
    expect(screen.getByTestId('mainview-surface').className).toContain('md:shadow-sm');

    rerender(<Harness activeId="settings" />);
    expect(screen.getByTestId('mainview-frame').className).toContain('md:p-0');
    expect(screen.getByTestId('mainview-surface').className).not.toContain('md:rounded-xl');
    expect(screen.getByTestId('mainview-surface').className).not.toContain('md:shadow-sm');
  });

  it('挂载后应用 localStorage 存档宽度(SSR 安全两段式),越界存档夹回区间', () => {
    window.localStorage.setItem(SHELL_SIDEBAR_WIDTH_STORAGE_KEY, '300');
    const { unmount } = render(<Harness />);
    expect(screen.getByTestId('app-sidebar').style.width).toBe('300px');
    unmount();

    window.localStorage.setItem(SHELL_SIDEBAR_WIDTH_STORAGE_KEY, '205');
    render(<Harness />);
    expect(screen.getByTestId('app-sidebar').style.width).toBe(`${SHELL_SIDEBAR_MIN_WIDTH}px`);
  });

  it('指针拖拽:跟随位移、写持久化、拖动期 data-resizing,松手恢复', () => {
    render(<Harness />);
    const handle = screen.getByTestId('sidebar-resize-handle');
    const root = handle.parentElement as HTMLElement;

    fireEvent(handle, new MouseEvent('pointerdown', { button: 0, clientX: 400, bubbles: true }));
    expect(root.getAttribute('data-resizing')).toBe('true');

    fireEvent(window, new MouseEvent('pointermove', { clientX: 460, bubbles: true }));
    expect(screen.getByTestId('app-sidebar').style.width).toBe('308px');
    expect(window.localStorage.getItem(SHELL_SIDEBAR_WIDTH_STORAGE_KEY)).toBe('308');
    expect(handle.getAttribute('aria-valuenow')).toBe('308');

    fireEvent(window, new MouseEvent('pointerup', { bubbles: true }));
    expect(root.getAttribute('data-resizing')).toBe('false');
  });

  it('拖拽夹取 [220, min(360, 32vw)] 边界', () => {
    render(<Harness />);
    const handle = screen.getByTestId('sidebar-resize-handle');
    fireEvent(handle, new MouseEvent('pointerdown', { button: 0, clientX: 248, bubbles: true }));
    fireEvent(window, new MouseEvent('pointermove', { clientX: 5000, bubbles: true }));
    expect(screen.getByTestId('app-sidebar').style.width).toBe('360px');
    fireEvent(window, new MouseEvent('pointermove', { clientX: -5000, bubbles: true }));
    expect(screen.getByTestId('app-sidebar').style.width).toBe('220px');
    fireEvent(window, new MouseEvent('pointerup', { bubbles: true }));
  });

  it('键盘:ArrowRight/Left ±16,Home 最小,End 动态上限(32vw)', () => {
    render(<Harness />);
    const handle = screen.getByTestId('sidebar-resize-handle');

    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(screen.getByTestId('app-sidebar').style.width).toBe('264px');
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(screen.getByTestId('app-sidebar').style.width).toBe('248px');
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(screen.getByTestId('app-sidebar').style.width).toBe('220px');
    fireEvent.keyDown(handle, { key: 'End' });
    expect(screen.getByTestId('app-sidebar').style.width).toBe('360px');

    // 窄窗口:End 落 32vw 动态上限(800 × 0.32 = 256)。
    setInnerWidth(800);
    fireEvent.keyDown(handle, { key: 'End' });
    expect(screen.getByTestId('app-sidebar').style.width).toBe('256px');
    expect(handle.getAttribute('aria-valuemax')).toBe('256');
  });

  it('双击手柄复位默认 248', () => {
    render(<Harness />);
    const handle = screen.getByTestId('sidebar-resize-handle');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(screen.getByTestId('app-sidebar').style.width).toBe('264px');
    fireEvent.doubleClick(handle);
    expect(screen.getByTestId('app-sidebar').style.width).toBe('248px');
    expect(window.localStorage.getItem(SHELL_SIDEBAR_WIDTH_STORAGE_KEY)).toBe('248');
  });

  it('收起后侧栏与手柄卸载,占位式窄轨出现(非浮层);展开恢复', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('sidebar-collapse'));

    expect(screen.queryByTestId('app-sidebar')).toBeNull();
    expect(screen.queryByTestId('sidebar-resize-handle')).toBeNull();
    const rail = screen.getByTestId('sidebar-expand-rail');
    // 占位式:布局流内 sticky 窄轨,不再 absolute 浮在内容上(ui-parity 01 §4-3)。
    expect(rail.className).toContain('sticky');
    expect(rail.className).not.toContain('absolute');

    fireEvent.click(screen.getByTestId('sidebar-expand'));
    expect(screen.getByTestId('app-sidebar')).toBeTruthy();
  });
});

describe('AppShell brandInset 几何(macOS 红绿灯让位,U01-fullscreen-inset)', () => {
  beforeEach(() => {
    stubMatchMedia(false);
    setInnerWidth(1440);
    stubLocalStorage();
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** 品牌行无 testid,以字标文本锚定其父容器(SidebarBody 首行)。 */
  const brandRow = () => screen.getByText('Musefold').parentElement as HTMLElement;

  it('brandInset=0(非 macOS/缺省):品牌行无内联缩进,收起轨 paddingTop 8px', () => {
    render(<Harness />);
    expect(brandRow().style.paddingLeft).toBe('');

    fireEvent.click(screen.getByTestId('sidebar-collapse'));
    expect(screen.getByTestId('sidebar-expand-rail').style.paddingTop).toBe('8px');
  });

  it('brandInset=78(macOS 非全屏):品牌行让位 78px,收起轨同步让位 36px', () => {
    render(<Harness brandInset={78} />);
    expect(brandRow().style.paddingLeft).toBe('78px');

    fireEvent.click(screen.getByTestId('sidebar-collapse'));
    expect(screen.getByTestId('sidebar-expand-rail').style.paddingTop).toBe('36px');
  });

  it('brandInset=12(macOS 原生全屏):品牌行回落 12px,收起轨保持让位档', () => {
    render(<Harness brandInset={12} />);
    expect(brandRow().style.paddingLeft).toBe('12px');

    fireEvent.click(screen.getByTestId('sidebar-collapse'));
    expect(screen.getByTestId('sidebar-expand-rail').style.paddingTop).toBe('36px');
  });
});

describe('AppShell compact 抽屉(<768px,承旧 overlay Drawer,ui-parity 01 §7 P2)', () => {
  let media: ReturnType<typeof stubMatchMedia>;

  beforeEach(() => {
    media = stubMatchMedia(true);
    setInnerWidth(700);
    stubLocalStorage();
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('compact 卸载常驻栏与手柄,移动顶栏给抽屉触发钮(唯一入口)', () => {
    render(<Harness />);
    expect(screen.queryByTestId('app-sidebar')).toBeNull();
    expect(screen.queryByTestId('sidebar-resize-handle')).toBeNull();
    expect(screen.getByTestId('sidebar-drawer-open')).toBeTruthy();
    // 移动端既有导航保持不变:底栏仍在。
    expect(screen.getByTestId('app-bottom-nav')).toBeTruthy();
  });

  it('打开抽屉:模态对话框承载侧栏内容,主区与底栏 inert', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('sidebar-drawer-open'));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    // 抽屉内是完整侧栏(nav/新设计/会话/账号区各就各位)。
    expect(screen.getByTestId('app-sidebar')).toBeTruthy();
    expect(screen.getByTestId('nav-prompts')).toBeTruthy();
    expect(screen.getByTestId('session-create')).toBeTruthy();
    expect(screen.getByTestId('session-abc123')).toBeTruthy();
    expect(screen.getByTestId('account-footer')).toBeTruthy();

    expect(isInert(screen.getByTestId('mainview-frame'))).toBe(true);
    expect(isInert(screen.getByTestId('app-bottom-nav'))).toBe(true);
  });

  it('Esc 关闭抽屉,焦点归还关闭前的焦点元素(承旧 rAF 归还)', async () => {
    render(
      <Harness>
        <button type="button" data-testid="main-focus-target">
          主区按钮
        </button>
      </Harness>,
    );
    const focusTarget = screen.getByTestId('main-focus-target');
    focusTarget.focus();
    expect(document.activeElement).toBe(focusTarget);

    fireEvent.click(screen.getByTestId('sidebar-drawer-open'));
    await screen.findByRole('dialog');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(focusTarget));
    // 抽屉关闭后 inert 解除。
    expect(isInert(screen.getByTestId('mainview-frame'))).toBe(false);
  });

  it('抽屉内点导航/新设计/会话行即收;行内动作钮不收(承旧 dismissOn)', async () => {
    const onNavigate = vi.fn();
    render(<Harness onNavigate={onNavigate} />);
    fireEvent.click(screen.getByTestId('sidebar-drawer-open'));
    await screen.findByRole('dialog');

    // 行内动作(置顶)保持抽屉打开:菜单/编辑锚在抽屉内。
    fireEvent.click(screen.getByTestId('session-pin'));
    expect(screen.getByRole('dialog')).toBeTruthy();

    // 会话打开行收抽屉。
    fireEvent.click(screen.getByTestId('session-abc123'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // 重开,导航项收抽屉并触发宿主跳转。
    fireEvent.click(screen.getByTestId('sidebar-drawer-open'));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByTestId('nav-prompts'));
    expect(onNavigate).toHaveBeenCalledWith('prompts');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // 再开,「新设计」同样收抽屉。
    fireEvent.click(screen.getByTestId('sidebar-drawer-open'));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByTestId('session-create'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('断点跨越:进入 compact 常驻栏卸载,离开 compact 恢复常驻栏', async () => {
    media.setMatches(false);
    render(<Harness />);
    expect(screen.getByTestId('app-sidebar')).toBeTruthy();

    media.setMatches(true);
    expect(screen.queryByTestId('app-sidebar')).toBeNull();
    expect(screen.getByTestId('sidebar-drawer-open')).toBeTruthy();

    // 抽屉开着时离开 compact:抽屉随形态卸载,常驻栏回来。
    fireEvent.click(screen.getByTestId('sidebar-drawer-open'));
    await screen.findByRole('dialog');
    media.setMatches(false);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('app-sidebar')).toBeTruthy();
  });

  it('导航切换(activeId 变化)自动收抽屉(承旧 compactDismissKey)', async () => {
    const { rerender } = render(<Harness activeId="workbench" />);
    fireEvent.click(screen.getByTestId('sidebar-drawer-open'));
    await screen.findByRole('dialog');
    rerender(<Harness activeId="prompts" />);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
