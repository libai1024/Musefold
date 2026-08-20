import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiConnectionProfile } from '@musefold/desktop-contracts/ai';

import {
  resetAiConnectionIOForTests,
  setAiConnectionIOForTests,
  useAiConnectionStore,
  type AiConnectionIO,
} from '../ai-connection-store';

const io: AiConnectionIO = {
  listAiConnectionPresets: vi.fn(),
  listAiConnections: vi.fn(),
  createAiConnection: vi.fn(),
  updateAiConnection: vi.fn(),
  deleteAiConnection: vi.fn(),
  saveAiConnectionKey: vi.fn(),
  deleteAiConnectionKey: vi.fn(),
  setActiveAiConnection: vi.fn(),
  listAiConnectionModels: vi.fn(),
  validateAiConnection: vi.fn(),
};

function profile(patch: Partial<AiConnectionProfile> = {}): AiConnectionProfile {
  return {
    id: 'ai-1',
    name: '团队网关',
    routeKind: 'gateway',
    protocol: 'openai-compatible',
    presetId: 'litellm',
    baseUrl: 'http://localhost:4000/v1',
    model: 'text-model',
    capabilities: {
      modelDiscovery: 'unknown',
      supportedStructuredOutputModes: ['json-schema', 'json-object', 'json-text'],
      preferredStructuredOutputMode: 'json-schema',
      cancellation: true,
      streaming: false,
      lastValidatedAt: null,
    },
    hasKey: false,
    keySuffix: null,
    isActive: true,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
    managedBy: patch.managedBy ?? null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  setAiConnectionIOForTests(io);
  useAiConnectionStore.setState({
    connections: [],
    presets: [],
    loaded: false,
    loading: false,
    error: null,
    dialogOpen: false,
    editingConnection: null,
    dialogPresetId: null,
    testStatus: {},
  });
});

afterAll(() => {
  resetAiConnectionIOForTests();
});

describe('AI connection settings store', () => {
  it('loads presets and sanitized connections through the dedicated API', async () => {
    vi.mocked(io.listAiConnectionPresets).mockResolvedValue([
      {
        id: 'custom',
        name: '自定义',
        routeKind: 'gateway',
        baseUrl: 'https://example.com/v1',
        model: 'm',
        hint: '',
      },
    ]);
    vi.mocked(io.listAiConnections).mockResolvedValue([profile()]);
    await useAiConnectionStore.getState().load();
    expect(useAiConnectionStore.getState()).toMatchObject({ loaded: true, loading: false });
    expect(useAiConnectionStore.getState().connections[0]).toMatchObject({
      id: 'ai-1',
      hasKey: false,
    });
  });

  it('never stores the submitted API key in renderer state', async () => {
    const secured = profile({ hasKey: true, keySuffix: '7890' });
    useAiConnectionStore.setState({ connections: [profile()] });
    vi.mocked(io.saveAiConnectionKey).mockResolvedValue(secured);
    await useAiConnectionStore.getState().saveKey('ai-1', 'sk-renderer-one-shot-1234567890');
    expect(io.saveAiConnectionKey).toHaveBeenCalledWith('ai-1', 'sk-renderer-one-shot-1234567890');
    expect(JSON.stringify(useAiConnectionStore.getState())).not.toContain('sk-renderer-one-shot');
    expect(useAiConnectionStore.getState().connections[0]).toMatchObject({
      hasKey: true,
      keySuffix: '7890',
    });
  });

  it('keeps a manual model when discovery is unavailable but text validation succeeds', async () => {
    useAiConnectionStore.setState({ connections: [profile({ hasKey: true })] });
    vi.mocked(io.validateAiConnection).mockResolvedValue({
      ok: true,
      message: '连接成功；请手工填写模型 ID',
      models: [],
      capabilities: { ...profile().capabilities, modelDiscovery: 'manual', lastValidatedAt: 20 },
    });
    const result = await useAiConnectionStore.getState().validate('ai-1');
    expect(result.ok).toBe(true);
    expect(useAiConnectionStore.getState().connections[0]).toMatchObject({
      model: 'text-model',
      capabilities: { modelDiscovery: 'manual' },
    });
    expect(useAiConnectionStore.getState().testStatus['ai-1']).toMatchObject({ state: 'success' });
  });

  it('revokes key status independently from the image provider store', async () => {
    useAiConnectionStore.setState({ connections: [profile({ hasKey: true, keySuffix: '7890' })] });
    vi.mocked(io.deleteAiConnectionKey).mockResolvedValue(profile());
    await useAiConnectionStore.getState().deleteKey('ai-1');
    expect(useAiConnectionStore.getState().connections[0]).toMatchObject({
      hasKey: false,
      keySuffix: null,
    });
    expect(useAiConnectionStore.getState().testStatus['ai-1']).toEqual({ state: 'idle' });
  });

  it('does not open or update an account-managed connection', async () => {
    const managed = profile({ managedBy: 'account' });
    useAiConnectionStore.setState({ connections: [managed] });

    useAiConnectionStore.getState().openDialog(managed);
    expect(useAiConnectionStore.getState().dialogOpen).toBe(false);
    await expect(
      useAiConnectionStore.getState().updateConnection(managed.id, { model: 'other-model' }),
    ).rejects.toThrow('固定管理');
    expect(io.updateAiConnection).not.toHaveBeenCalled();
  });
});
