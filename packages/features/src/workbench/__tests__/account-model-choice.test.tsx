import type { AccountModelCatalog, AccountSummary } from '@musefold/contracts';
import {
  type MusefoldGateway,
  PlatformProvider,
  queryKeys,
  WEB_CAPABILITIES,
} from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAccountSession, beginAccountTransition } from '../../account/account-session';
import { AccountModelSelector } from '../AccountModelSelector';
import {
  assertModelCatalogAccount,
  modelPreferenceKey,
  modelPriceLabel,
  modelSubmission,
  modelUnavailableReason,
  readModelPreference,
  writeModelPreference,
} from '../account-model-choice';
import { useAccountModelChoice } from '../use-account-model-choice';

const account: AccountSummary = {
  id: 'owner-a',
  username: 'same-name',
  displayName: null,
  quota: 100000,
  quotaUnit: 'quota',
  canGenerate: true,
  identity: {
    apiIssuer: 'https://api.test',
    principalId: 'principal-a',
    identityVersion: 1,
    status: 'active',
  },
};
function catalog(owner = 'a', quotaPerCall = 60000): AccountModelCatalog {
  return {
    identity: {
      apiIssuer: 'https://api.test',
      principalId: `principal-${owner}`,
      payer: { issuer: 'https://upstream.test', ownerId: `owner-${owner}` },
      credential: { ref: `credential-${owner}`, version: 1 },
    },
    group: 'account-group',
    checkedAt: '2026-09-20T00:00:00.000Z',
    models: [
      {
        model: 'musefold-image-pro',
        imageGeneration: true,
        supportedEndpointTypes: ['openai'],
        pricing: { kind: 'per_call', baseUsd: 0.04, groupRatio: 3, quotaPerCall: 60000 },
      },
      {
        model: 'gpt-image-2',
        imageGeneration: true,
        supportedEndpointTypes: ['openai'],
        pricing: { kind: 'per_call', baseUsd: 0.04, groupRatio: 3, quotaPerCall },
      },
      {
        model: 'missing-price',
        imageGeneration: true,
        supportedEndpointTypes: ['image-generation'],
        pricing: { kind: 'unavailable', reason: 'missing_price' },
      },
    ],
  };
}
function setup() {
  let currentAccount = account;
  const read = vi.fn(async () => catalog());
  const gateway = {
    account: { getStatus: async () => currentAccount, getModelCatalog: read },
  } as unknown as MusefoldGateway;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(queryKeys.account.status(), currentAccount);
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <PlatformProvider runtime={{ gateway, capabilities: WEB_CAPABILITIES }}>
        {children}
      </PlatformProvider>
    </QueryClientProvider>
  );
  return {
    client,
    read,
    Wrapper,
    gateway,
    setAccount: (next: AccountSummary) => {
      currentAccount = next;
    },
  };
}

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('account model choice and cloud price presentation', () => {
  it('uses cloud quota including its ratio once, and distinguishes explicit zero from unavailable', () => {
    expect(modelPriceLabel(catalog().models[0].pricing)).toBe('1.2 积分/计费次');
    expect(modelPriceLabel({ kind: 'per_call', baseUsd: 0, groupRatio: 3, quotaPerCall: 0 })).toBe(
      '0 积分/计费次',
    );
    expect(modelPriceLabel({ kind: 'unavailable', reason: 'missing_price' })).toBe('价格不可用');
    expect(
      modelPriceLabel({
        kind: 'usage',
        groupRatio: 2,
        inputQuotaPerToken: 1,
        outputQuotaPerToken: 2,
      }),
    ).toBe('输入 20 / 输出 40 积分/百万 token');
    expect(
      modelPriceLabel({ kind: 'per_call', baseUsd: 1e-12, groupRatio: 1, quotaPerCall: 1e-12 }),
    ).not.toMatch(/^0 积分/);
  });

  it.each([
    'missing_price',
    'group_not_enabled',
    'missing_group_ratio',
    'unsupported_billing',
    'invalid_price',
  ] as const)('never submits unavailable pricing: %s', (reason) => {
    const data = catalog();
    data.models[0].pricing = { kind: 'unavailable', reason };
    expect(() => modelSubmission(data, data.models[0].model)).toThrow();
  });

  it('rejects unsupported image transport, missing model, and mismatched account identity', () => {
    const data = catalog();
    data.models[0].imageGeneration = false;
    expect(modelUnavailableReason(data.models[0])).toContain('图像生成接口');
    expect(() => modelSubmission(data, 'unlisted')).toThrow('重新选择');
    expect(() => assertModelCatalogAccount(catalog('b'), account)).toThrow('当前账号不一致');
    expect(() =>
      assertModelCatalogAccount(catalog(), { ...account, identity: undefined }),
    ).toThrow();
  });

  it('persists only a model identifier, scoped to service, principal and payer (not rotating credentials)', () => {
    const data = catalog();
    const key = modelPreferenceKey(data);
    expect(writeModelPreference(key, 'gpt-image-2')).toBe(true);
    expect(readModelPreference(key)).toBe('gpt-image-2');
    expect(readModelPreference(modelPreferenceKey(catalog('b')))).toBeNull();
    expect(
      modelPreferenceKey({
        ...data,
        identity: { ...data.identity, apiIssuer: 'https://other.test' },
      }),
    ).not.toBe(key);
    expect(
      modelPreferenceKey({
        ...data,
        identity: { ...data.identity, payer: { ...data.identity.payer, ownerId: 'other' } },
      }),
    ).not.toBe(key);
    expect(
      modelPreferenceKey({
        ...data,
        identity: { ...data.identity, credential: { ref: 'rotated', version: 2 } },
      }),
    ).toBe(key);
    expect(localStorage.getItem(key)).toBe('gpt-image-2');
    localStorage.setItem(key, 'bad model');
    expect(readModelPreference(key)).toBeNull();
  });

  it('captures selected model with its matching expectation and restores selection on remount', async () => {
    const { Wrapper, read } = setup();
    const first = renderHook(() => useAccountModelChoice(true), { wrapper: Wrapper });
    await waitFor(() => expect(first.result.current.reason).toBeNull());
    act(() => first.result.current.selectModel('gpt-image-2'));
    await act(async () => {
      expect(await first.result.current.prepareSubmission()).toMatchObject({
        model: 'gpt-image-2',
        expectedBinding: { model: 'gpt-image-2', principalId: 'principal-a' },
      });
    });
    expect(read).toHaveBeenCalledTimes(2);
    first.unmount();
    const second = renderHook(() => useAccountModelChoice(true), { wrapper: Wrapper });
    await waitFor(() => expect(second.result.current.model).toBe('gpt-image-2'));
  });

  it('does not silently substitute another model when a saved choice is removed', async () => {
    writeModelPreference(modelPreferenceKey(catalog()), 'removed-model');
    const { Wrapper } = setup();
    const { result } = renderHook(() => useAccountModelChoice(true), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.model).toBe('removed-model'));
    expect(result.current.reason).toContain('重新选择');
    await expect(result.current.prepareSubmission()).rejects.toThrow('重新选择');
    act(() => result.current.selectModel('missing-price'));
    expect(result.current.model).toBe('removed-model');
    act(() => result.current.selectModel('gpt-image-2'));
    expect(result.current.reason).toBeNull();
  });

  it.each(['removed', 'unpriced'] as const)(
    'keeps the initially displayed model when a refresh makes it %s, even without a user selection',
    async (change) => {
      const { Wrapper, read } = setup();
      const { result } = renderHook(() => useAccountModelChoice(true), { wrapper: Wrapper });
      await waitFor(() => expect(result.current.model).toBe('musefold-image-pro'));
      const next = catalog();
      if (change === 'removed') next.models.shift();
      else next.models[0].pricing = { kind: 'unavailable', reason: 'missing_price' };
      read.mockResolvedValue(next);
      await act(() => result.current.refresh());
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.model).toBe('musefold-image-pro');
      expect(result.current.reason).toContain(change === 'removed' ? '重新选择' : '未提供价格');
      await expect(result.current.prepareSubmission()).rejects.toThrow();
      act(() => result.current.selectModel('gpt-image-2'));
      expect(result.current.model).toBe('gpt-image-2');
      expect(result.current.reason).toBeNull();
    },
  );

  it('updates changed cloud prices but requires another explicit send before accepting them', async () => {
    const { Wrapper, read } = setup();
    const { result } = renderHook(() => useAccountModelChoice(true), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.reason).toBeNull());
    act(() => result.current.selectModel('gpt-image-2'));
    read.mockResolvedValue(catalog('a', 90000));
    await act(async () => {
      await expect(result.current.prepareSubmission()).rejects.toThrow('价格已更新');
    });
    await waitFor(() =>
      expect(result.current.selected && modelPriceLabel(result.current.selected.pricing)).toBe(
        '1.8 积分/计费次',
      ),
    );
    await act(async () => {
      expect((await result.current.prepareSubmission()).model).toBe('gpt-image-2');
    });
  });

  it('does not authorize a changed credential identity from an old display', async () => {
    const { Wrapper, read } = setup();
    const { result } = renderHook(() => useAccountModelChoice(true), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.reason).toBeNull());
    const next = catalog();
    next.identity.credential.version = 2;
    read.mockResolvedValue(next);
    await act(async () => {
      await expect(result.current.prepareSubmission()).rejects.toThrow('执行身份已变化');
    });
  });

  it('hides stale prices after refresh fails and recovers only after a successful read', async () => {
    const { Wrapper, read } = setup();
    const { result } = renderHook(() => useAccountModelChoice(true), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.reason).toBeNull());
    read.mockRejectedValueOnce(new Error('unavailable'));
    await act(() => result.current.refresh());
    await waitFor(() => expect(result.current.catalog).toBeUndefined());
    expect(result.current.reason).toContain('读取失败');
    await expect(result.current.prepareSubmission()).rejects.toThrow('读取失败');
    await act(() => result.current.refresh());
    await waitFor(() => expect(result.current.reason).toBeNull());
  });

  it('immediately hides catalog during transition, rejects late old replies and isolates the next account', async () => {
    const { Wrapper, read, client, setAccount } = setup();
    const { result } = renderHook(() => useAccountModelChoice(true), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.reason).toBeNull());
    act(() => result.current.selectModel('gpt-image-2'));
    let resolve!: (value: AccountModelCatalog) => void;
    read.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.prepareSubmission().catch((error: unknown) => error);
    });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    let nextEpoch = 0;
    act(() => {
      nextEpoch = beginAccountTransition(client);
    });
    expect(result.current.catalog).toBeUndefined();
    expect(result.current.model).toBe('');
    await act(async () => {
      resolve(catalog());
      await pending;
    });
    expect(await pending).toBeInstanceOf(Error);
    if (!account.identity) throw new Error('Missing test identity');
    const nextAccount = {
      ...account,
      id: 'owner-b',
      identity: { ...account.identity, principalId: 'principal-b' },
    };
    setAccount(nextAccount);
    read.mockResolvedValue(catalog('b'));
    await act(() => applyAccountSession(client, nextAccount, nextEpoch));
    await waitFor(() => expect(result.current.reason).toBeNull());
    expect(result.current.model).toBe('musefold-image-pro');
    expect(result.current.catalog?.identity.principalId).toBe('principal-b');
  });

  it('does not fetch account prices for BYOK/disabled selection', async () => {
    const { Wrapper, read } = setup();
    const { result } = renderHook(() => useAccountModelChoice(false), { wrapper: Wrapper });
    expect(result.current.reason).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it('can explicitly recheck an unchanged account after a failed transition without a stale catalog', async () => {
    const { Wrapper, client } = setup();
    const { result } = renderHook(() => useAccountModelChoice(true), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.reason).toBeNull());
    act(() => {
      beginAccountTransition(client);
    });
    expect(result.current.catalog).toBeUndefined();
    await act(() => result.current.refresh());
    await waitFor(() => expect(result.current.reason).toBeNull());
  });

  it('explains empty catalogs and never supplies a local fallback price or model', async () => {
    const { Wrapper, read } = setup();
    read.mockResolvedValue({ ...catalog(), models: [] });
    const { result } = renderHook(() => useAccountModelChoice(true), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.reason).toContain('没有可用模型'));
    expect(result.current.model).toBe('');
    await expect(result.current.prepareSubmission()).rejects.toThrow('没有可用模型');
  });

  it('fails closed on a mismatched catalog even when a model name and username are identical', async () => {
    const { Wrapper, read } = setup();
    read.mockResolvedValue(catalog('b'));
    const { result } = renderHook(() => useAccountModelChoice(true), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.reason).toContain('读取失败'));
    expect(result.current.catalog).toBeUndefined();
    expect(result.current.model).toBe('');
  });

  it('keeps the selected model usable but explains storage failure', async () => {
    const { Wrapper } = setup();
    const { result } = renderHook(() => useAccountModelChoice(true), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.reason).toBeNull());
    const fail = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    try {
      act(() => result.current.selectModel('gpt-image-2'));
      expect(result.current.model).toBe('gpt-image-2');
      expect(result.current.persistenceWarning).toContain('无法保存');
    } finally {
      fail.mockRestore();
    }
  });

  it('renders labelled controls and readable cloud-price/error states', async () => {
    const { Wrapper, read } = setup();
    function Screen() {
      const choice = useAccountModelChoice(true);
      return <AccountModelSelector choice={choice} />;
    }
    render(<Screen />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByTestId('composer-model-price').textContent).toContain('1.2 积分'),
    );
    expect(screen.getByRole('combobox', { name: '账号模型' })).toBeTruthy();
    read.mockRejectedValueOnce(new Error('network'));
    fireEvent.click(screen.getByRole('button', { name: '刷新云端模型与价格' }));
    await waitFor(() =>
      expect(screen.getByTestId('composer-model-price').textContent).toContain('读取失败'),
    );
    expect(screen.getByRole('combobox').hasAttribute('disabled')).toBe(true);
  });
});
