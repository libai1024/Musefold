import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  fromId: vi.fn(),
  create: vi.fn(() => ({ close: vi.fn() })),
}));
vi.mock('electron', () => ({ webContents: { fromId: fixtures.fromId } }));
vi.mock('@musefold/core/services/local-upload-owner', () => ({
  createLocalUploadOwner: fixtures.create,
}));
import { closeWindowUploadOwners, windowUploadOwner } from '../local-upload-owners';

const windows = new Map<number, EventEmitter & { isDestroyed: () => boolean }>();
function window(id: number) {
  const target = Object.assign(new EventEmitter(), { isDestroyed: (): boolean => false });
  windows.set(id, target);
  fixtures.fromId.mockImplementation((senderId: number) => windows.get(senderId));
  return target;
}
afterEach(() => {
  for (const target of windows.values()) target.emit('destroyed');
  windows.clear();
  vi.clearAllMocks();
});

it.each([undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
  'rejects invalid trusted sender %s before creating a lifetime',
  (id) => {
    expect(() => windowUploadOwner(id)).toThrow('参考图上传需要有效窗口');
    expect(fixtures.create).not.toHaveBeenCalled();
  },
);
it('rejects missing and destroyed windows', () => {
  fixtures.fromId.mockReturnValue(undefined);
  expect(() => windowUploadOwner(41)).toThrow('参考图所属窗口已关闭');
  const target = window(41);
  target.isDestroyed = () => true;
  expect(() => windowUploadOwner(41)).toThrow('参考图所属窗口已关闭');
  expect(fixtures.create).not.toHaveBeenCalled();
});
it.each(['destroyed', 'render-process-gone'])(
  'closes only the affected owner on %s and removes all its listeners',
  (event) => {
    const one = window(41);
    const two = window(42);
    const first = windowUploadOwner(41);
    const second = windowUploadOwner(42);
    expect(windowUploadOwner(41)).toBe(first);
    one.emit(event);
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).not.toHaveBeenCalled();
    expect(one.eventNames()).toEqual([]);
    two.emit('destroyed');
    expect(second.close).toHaveBeenCalledTimes(1);
  },
);
it('keeps same-document and subframe navigation, but replaces the lifetime when the main document reloads', () => {
  const target = window(41);
  const first = windowUploadOwner(41);
  target.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
  target.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false });
  expect(windowUploadOwner(41)).toBe(first);
  expect(first.close).not.toHaveBeenCalled();
  target.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  expect(first.close).toHaveBeenCalledTimes(1);
  const second = windowUploadOwner(41);
  expect(second).not.toBe(first);
  expect(target.listenerCount('destroyed')).toBe(1);
  target.emit('destroyed');
  expect(first.close).toHaveBeenCalledTimes(1);
  expect(second.close).toHaveBeenCalledTimes(1);
});

it('releases all windows before host database shutdown and removes listeners idempotently', () => {
  const one = window(41);
  const two = window(42);
  const first = windowUploadOwner(41);
  const second = windowUploadOwner(42);
  closeWindowUploadOwners();
  closeWindowUploadOwners();
  expect(first.close).toHaveBeenCalledTimes(1);
  expect(second.close).toHaveBeenCalledTimes(1);
  expect(one.eventNames()).toEqual([]);
  expect(two.eventNames()).toEqual([]);
});
