import type { Page } from '@playwright/test';
import { afterEach, describe, expect, it, vi } from 'vitest';

const observed = vi.hoisted(() => ({ visible: vi.fn(), attach: vi.fn() }));
vi.mock('@playwright/test', () => ({
  expect: () => ({ toBeVisible: observed.visible }),
  test: { info: () => ({ attach: observed.attach }) },
}));
import { submitLiveLogin } from '../live-account-helpers';

afterEach(() => vi.unstubAllEnvs());

describe('live login verification', () => {
  it.each([false, true])(
    'submits once, clears the password and records safe timing (failure=%s)',
    async (fail) => {
      vi.resetAllMocks();
      vi.stubEnv('MUSEFOLD_E2E_USERNAME', 'synthetic-user');
      vi.stubEnv('MUSEFOLD_E2E_PASSWORD', 'synthetic-password');
      const input = { fill: vi.fn(), isVisible: vi.fn().mockResolvedValue(true) };
      const submit = { click: vi.fn() };
      const page = {
        on: vi.fn(),
        off: vi.fn(),
        getByTestId: (id: string) => (id === 'account-auth-submit' ? submit : input),
      };
      observed.visible.mockImplementation(async () => {
        expect(input.fill).toHaveBeenLastCalledWith('');
        if (fail) throw new Error('original login failure');
      });
      const result = submitLiveLogin(page as unknown as Page);
      if (fail) await expect(result).rejects.toThrow('original login failure');
      else await result;
      expect(submit.click).toHaveBeenCalledTimes(1);
      expect(observed.visible).toHaveBeenCalledExactlyOnceWith({ timeout: 60000 });
      expect(page.off).toHaveBeenCalledWith('response', page.on.mock.calls[0][1]);
      expect(observed.attach).toHaveBeenCalledTimes(1);
      expect(observed.attach.mock.calls[0][1].body).not.toContain('synthetic-password');
      expect(observed.attach.mock.calls[0][1].body).not.toContain('synthetic-user');
    },
  );
});
