import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { attachPetWindowLifecycle, canEnterPetPage } from '../lifecycle';

describe('pet page lifecycle', () => {
  it('enters the page while the main window is visible and not minimized', () => {
    const state = {
      destroyed: false,
      visible: true,
      minimized: false,
      focused: true,
    };
    const win = {
      isDestroyed: () => state.destroyed,
      isVisible: () => state.visible,
      isMinimized: () => state.minimized,
      isFocused: () => state.focused,
    } as unknown as BrowserWindow;

    expect(canEnterPetPage(win)).toBe(true);
    state.minimized = true;
    expect(canEnterPetPage(win)).toBe(false);
    state.minimized = false;
    state.focused = false;
    expect(canEnterPetPage(win)).toBe(true);
    state.focused = true;
    state.visible = false;
    expect(canEnterPetPage(win)).toBe(false);
  });

  it('enters, leaves, and follows the main window for every relevant event', () => {
    const listeners = new Map<string, () => void>();
    const win = {
      on: vi.fn((event: string, listener: () => void) => {
        listeners.set(event, listener);
      }),
    } as unknown as BrowserWindow;
    const actions = {
      enterPage: vi.fn(),
      leavePage: vi.fn(),
      syncWithPage: vi.fn(),
    };

    attachPetWindowLifecycle(win, actions);
    for (const event of ['move', 'resize']) listeners.get(event)?.();
    for (const event of ['show', 'restore']) listeners.get(event)?.();
    for (const event of ['minimize', 'hide']) listeners.get(event)?.();

    expect(actions.syncWithPage).toHaveBeenCalledTimes(2);
    expect(actions.enterPage).toHaveBeenCalledTimes(2);
    expect(actions.leavePage).toHaveBeenCalledTimes(2);
  });
});
