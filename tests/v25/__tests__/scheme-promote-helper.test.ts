import type { Page } from '@playwright/test';
import { describe, expect, it, vi } from 'vitest';

const assertions = vi.hoisted(() => ({
  toBeVisible: vi.fn().mockResolvedValue(undefined),
  toHaveAttribute: vi.fn().mockResolvedValue(undefined),
  toHaveCount: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@playwright/test', () => ({ expect: () => assertions, test: {} }));

import { selectTrialCover } from '../web.scheme-promote-helper';

describe('live scheme cover selection', () => {
  it('submits once and waits for the actual refreshed exact-cover UI, not a fixed sleep', async () => {
    vi.clearAllMocks();
    const image = { getAttribute: vi.fn().mockResolvedValue('/assets/target-image/content') };
    const cover = { click: vi.fn().mockResolvedValue(undefined) };
    const album = { getByRole: vi.fn().mockReturnValue(image) };
    const detail = {};
    const getByTestId = vi.fn((id: string) => {
      if (id === 'runtime-scheme-detail') return detail;
      if (id === 'runtime-scheme-album') return album;
      if (id === 'runtime-scheme-set-cover') return cover;
      throw new Error(`Unexpected test target: ${id}`);
    });

    await selectTrialCover({ getByTestId } as unknown as Page, 'target-image', 1);

    expect(cover.click).toHaveBeenCalledTimes(1);
    expect(assertions.toHaveCount).toHaveBeenCalledExactlyOnceWith(0, { timeout: 30_000 });
    expect(assertions.toHaveAttribute).toHaveBeenLastCalledWith('src', /\/target-image\/content$/);
  });
});
