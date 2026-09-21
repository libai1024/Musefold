import { createHash, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DesignSchemePackageExport } from '@musefold/contracts';
import { createWebSchemePackageExport } from '../scheme-package-export';

const bytes = new TextEncoder().encode('complete archive fixture');
const ready: DesignSchemePackageExport = {
  exportId: 'export_1',
  requestId: 'request_1',
  schemeId: 'scheme',
  revisionId: 'revision',
  status: 'ready',
  formatVersion: 2,
  packageHash: createHash('sha256').update(bytes).digest('hex'),
  sizeBytes: bytes.length,
  expiresAt: '2099-01-01T00:00:00.000Z',
};
const pickerWindow = window as Window & { showSaveFilePicker?: unknown };
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
});
afterEach(() => {
  delete pickerWindow.showSaveFilePicker;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function setup() {
  const order: string[] = [];
  const fetch = vi.fn(async (url: string | URL | Request) => {
    const path = String(url);
    order.push(path.endsWith('/content') ? 'bytes' : 'metadata');
    return path.endsWith('/content')
      ? new Response(bytes, {
          headers: {
            'content-type': 'application/octet-stream',
            'content-length': String(bytes.length),
          },
        })
      : new Response(JSON.stringify(ready), { headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetch);
  const abort = new AbortController();
  const assertCurrent = vi.fn();
  const writable = {
    write: vi.fn(async (_bytes: Uint8Array) => {
      order.push('write');
    }),
    close: vi.fn(async () => {
      order.push('close');
    }),
    abort: vi.fn(async () => {}),
  };
  const createWritable = vi.fn(async () => writable);
  const picker = vi.fn(async () => {
    order.push('picker');
    return { createWritable };
  });
  pickerWindow.showSaveFilePicker = picker;
  const save = () =>
    createWebSchemePackageExport('/').save(ready, { signal: abort.signal, assertCurrent });
  return { order, fetch, abort, assertCurrent, writable, createWritable, picker, save };
}
it('opens the picker in the click before network IO and reports delivery only after close', async () => {
  const f = setup();
  const pending = f.save();
  expect(f.order).toEqual(['picker']);
  expect(await pending).toEqual({ exportId: 'export_1', status: 'delivered' });
  expect(f.order).toEqual(['picker', 'metadata', 'bytes', 'write', 'close']);
  expect(Array.from(f.writable.write.mock.calls[0]?.[0] ?? [])).toEqual(Array.from(bytes));
  expect(f.writable.abort).not.toHaveBeenCalled();
});
it('picker cancel does not fetch or create a file', async () => {
  const f = setup();
  f.picker.mockRejectedValue(new DOMException('user cancelled', 'AbortError'));
  expect((await f.save()).status).toBe('cancelled');
  expect(f.fetch).not.toHaveBeenCalled();
  expect(f.createWritable).not.toHaveBeenCalled();
});
it('picker permission error never silently falls back to a download', async () => {
  const f = setup();
  f.picker.mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
  await expect(f.save()).rejects.toThrow('denied');
  expect(f.fetch).not.toHaveBeenCalled();
});
it('refuses changed export metadata before reading bytes or opening a writable', async () => {
  const f = setup();
  f.fetch.mockResolvedValue(new Response(JSON.stringify({ ...ready, revisionId: 'other' })));
  await expect(f.save()).rejects.toThrow('已变化');
  expect(f.fetch).toHaveBeenCalledOnce();
  expect(f.createWritable).not.toHaveBeenCalled();
});
it('refuses corrupted byte hash before opening a writable', async () => {
  const f = setup();
  f.fetch.mockResolvedValueOnce(new Response(JSON.stringify(ready))).mockResolvedValueOnce(
    new Response(new Uint8Array(bytes.length), {
      headers: { 'content-type': 'application/octet-stream' },
    }),
  );
  await expect(f.save()).rejects.toThrow('hash mismatch');
  expect(f.createWritable).not.toHaveBeenCalled();
});
it('abort after picker stops network and does not report user picker cancellation', async () => {
  const f = setup();
  f.picker.mockImplementation(async () => {
    f.abort.abort();
    return { createWritable: f.createWritable };
  });
  await expect(f.save()).rejects.toThrow();
  expect(f.fetch).not.toHaveBeenCalled();
});
it('account change during writing aborts the uncommitted file without closing it', async () => {
  const f = setup();
  f.writable.write.mockImplementation(async () => {
    f.assertCurrent.mockImplementation(() => {
      throw new Error('账号已切换');
    });
  });
  await expect(f.save()).rejects.toThrow('账号已切换');
  expect(f.writable.close).not.toHaveBeenCalled();
  expect(f.writable.abort).toHaveBeenCalledOnce();
});
it('close failure aborts the writable and never claims delivery', async () => {
  const f = setup();
  f.writable.close.mockRejectedValue(new Error('disk full'));
  await expect(f.save()).rejects.toThrow('disk full');
  expect(f.writable.abort).toHaveBeenCalledOnce();
});
it('browser fallback uses a verified blob and reports only a handoff with bounded URL cleanup', async () => {
  const f = setup();
  delete pickerWindow.showSaveFilePicker;
  vi.useFakeTimers();
  const create = vi.fn((_blob: Blob) => 'blob:verified');
  const revoke = vi.fn();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    expect(this.download).toBe('Musefold-export_1.musefold.design');
    expect(this.href).toBe('blob:verified');
  });
  expect((await f.save()).status).toBe('download-started');
  expect(click).toHaveBeenCalledOnce();
  expect(create.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
  expect(document.querySelector('a[download]')).toBeNull();
  expect(revoke).not.toHaveBeenCalled();
  vi.advanceTimersByTime(60_000);
  expect(revoke).toHaveBeenCalledWith('blob:verified');
});
it('an expired export never opens a save picker', async () => {
  const f = setup();
  await expect(
    createWebSchemePackageExport('/').save(
      { ...ready, expiresAt: '2000-01-01T00:00:00.000Z' },
      { signal: f.abort.signal, assertCurrent: f.assertCurrent },
    ),
  ).rejects.toThrow('过期');
  expect(f.picker).not.toHaveBeenCalled();
});
