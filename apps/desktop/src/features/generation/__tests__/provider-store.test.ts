import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderConfig } from '@musefold/desktop-contracts/models';

const providerApi = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  saveKey: vi.fn(),
  hasKey: vi.fn(),
  openWebLogin: vi.fn(),
  setActive: vi.fn(),
  validate: vi.fn(),
  listModels: vi.fn(),
}));

vi.mock('../../../lib/ipc', () => ({ default: { provider: providerApi } }));

import { useGenerationStore } from '../store';

function provider(patch: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'provider-1',
    name: '中转站',
    type: 'openai-compatible',
    baseUrl: 'https://relay.test/v1',
    model: 'gpt-image-2',
    hasKey: true,
    keySuffix: '1234',
    isActive: true,
    managedBy: null,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useGenerationStore.setState({
    providers: [],
    providersLoaded: true,
    activeProviderId: null,
    providerDialogOpen: false,
    editingProvider: null,
    dialogPresetId: null,
    testStatus: {},
    testingAll: false,
  });
});

describe('provider settings store', () => {
  it('does not open or update an account-managed provider', async () => {
    const managed = provider({ id: 'managed', managedBy: 'account' });
    useGenerationStore.setState({ providers: [managed], activeProviderId: managed.id });

    useGenerationStore.getState().openProviderDialog(managed);
    expect(useGenerationStore.getState().providerDialogOpen).toBe(false);
    await expect(useGenerationStore.getState().updateProvider(managed.id, { model: 'other-model' }))
      .rejects.toThrow('固定管理');
    expect(providerApi.update).not.toHaveBeenCalled();
  });

  it('batch-tests station providers only', async () => {
    const managed = provider({ id: 'managed', managedBy: 'account' });
    const station = provider({ id: 'station', isActive: false });
    const doubao = provider({ id: 'doubao', type: 'doubao-web', isActive: false });
    useGenerationStore.setState({ providers: [managed, station, doubao] });
    providerApi.validate.mockResolvedValue({ ok: true, message: 'ok' });

    await useGenerationStore.getState().testAll();

    expect(providerApi.validate).toHaveBeenCalledTimes(1);
    expect(providerApi.validate).toHaveBeenCalledWith('station');
  });

  it('validates a Doubao web provider even before a browser session is marked ready', async () => {
    const doubao = provider({
      id: 'doubao-web',
      name: '豆包网页版',
      type: 'doubao-web',
      baseUrl: 'https://www.doubao.com/chat/create-image',
      model: 'seedream-4.5',
      hasKey: false,
      keySuffix: null,
    });
    useGenerationStore.setState({ providers: [doubao] });
    providerApi.validate.mockResolvedValue({ ok: false, code: 'AUTH', message: '请先登录' });
    providerApi.list.mockResolvedValue([doubao]);

    const result = await useGenerationStore.getState().testProvider(doubao.id);

    expect(providerApi.validate).toHaveBeenCalledWith(doubao.id);
    expect(result).toMatchObject({ state: 'failed', code: 'AUTH' });
    expect(result.state).not.toBe('skipped');
  });
});
