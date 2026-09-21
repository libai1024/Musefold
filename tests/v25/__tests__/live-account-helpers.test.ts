import type { Page } from '@playwright/test';
import { describe, expect, it, vi } from 'vitest';
import { logoutLiveWeb } from '../live-account-helpers';

describe('live session cleanup', () => {
  it('uses the owning browser request context and the real JSON logout contract', async () => {
    const post = vi.fn().mockResolvedValue({ status: () => 200 });
    await logoutLiveWeb({ request: { post } } as unknown as Page);
    expect(post).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:3399/api/auth/sign-out', {
      headers: { Origin: 'http://127.0.0.1:3399' },
      data: {},
    });
  });

  it.each([401, 415, 500])('does not claim HTTP %i released the session', async (status) => {
    const post = vi.fn().mockResolvedValue({ status: () => status });
    await expect(logoutLiveWeb({ request: { post } } as unknown as Page)).rejects.toThrow(
      'Live browser session cleanup',
    );
  });
});
