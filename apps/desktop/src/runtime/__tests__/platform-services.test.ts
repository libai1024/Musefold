import { beforeEach, describe, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
const saveImage = vi.hoisted(() => vi.fn());

vi.mock('../../stores/toast', () => ({ toast }));
vi.mock('@renderer/runtime/desktop-host-services', () => ({
  desktopHost: { system: { saveImage } },
}));

import { createDesktopPlatformServices } from '../platform-services';

describe('desktop platform services', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it('routes toast, clipboard, http download and local save', async () => {
    const click = vi.fn();
    vi.stubGlobal('document', {
      createElement: () => ({ click, href: '', rel: '', download: '' }),
    });
    const platform = createDesktopPlatformServices();
    platform.toast.success('ok', 'done');
    await platform.writeClipboard('hi');
    await platform.download('https://example.com/a.png', 'a.png');
    await platform.download('/tmp/a.png');
    expect(toast.success).toHaveBeenCalledWith('ok', 'done');
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hi');
    expect(click).toHaveBeenCalledOnce();
    expect(saveImage).toHaveBeenCalledWith('/tmp/a.png');
  });
});
