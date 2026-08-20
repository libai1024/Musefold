import { describe, expect, it, vi } from 'vitest';
import { IPC } from '@musefold/desktop-contracts/ipc';
import type { AiConnectionProfile } from '@musefold/desktop-contracts/ai';
import { registerAiConnectionHandlers } from '../ai-connections';

type Handler = (event: unknown, ...args: any[]) => unknown;

function profile(): AiConnectionProfile {
  return {
    id: 'connection-1',
    name: 'Official Agent',
    routeKind: 'gateway',
    protocol: 'openai-compatible',
    presetId: 'account',
    baseUrl: 'https://api.example.test/v1',
    model: 'agent-model',
    capabilities: {
      modelDiscovery: 'unknown',
      supportedStructuredOutputModes: ['json-schema', 'json-object', 'json-text'],
      preferredStructuredOutputMode: 'json-object',
      cancellation: true,
      streaming: false,
      lastValidatedAt: null,
    },
    hasKey: true,
    keySuffix: '1234',
    isActive: true,
    managedBy: 'account',
    createdAt: 1,
    updatedAt: 1,
  };
}

function harness() {
  const handlers = new Map<string, Handler>();
  const connection = profile();
  const store = {
    list: vi.fn(() => [connection]),
    get: vi.fn(() => connection),
    require: vi.fn(() => connection),
    create: vi.fn(() => connection),
    update: vi.fn(() => connection),
    delete: vi.fn(),
    saveKey: vi.fn(() => connection),
    deleteKey: vi.fn(() => connection),
    setActive: vi.fn(() => connection),
    loadKey: vi.fn(() => 'secret-token'),
    updateCapabilities: vi.fn((_id, patch) => ({
      ...connection,
      capabilities: { ...connection.capabilities, ...patch },
    })),
  };
  const assistant = {
    listModels: vi.fn(async () => [{ id: 'agent-model', name: 'Agent Model' }]),
    validateConnection: vi.fn(async () => ({
      models: [{ id: 'agent-model', name: 'Agent Model' }],
      modelDiscovery: 'available' as const,
    })),
  };
  registerAiConnectionHandlers({
    target: { handle: ((channel: string, listener: Handler) => handlers.set(channel, listener)) as never },
    store: store as never,
    createAssistant: () => assistant,
    now: () => 100,
  });
  return { handlers, store, assistant };
}

describe('AI connection IPC handlers', () => {
  it('registers the complete preload surface', () => {
    const { handlers } = harness();
    expect([...handlers.keys()].sort()).toEqual([
      IPC.AI_CONNECTION_LIST_PRESETS,
      IPC.AI_CONNECTION_LIST,
      IPC.AI_CONNECTION_CREATE,
      IPC.AI_CONNECTION_UPDATE,
      IPC.AI_CONNECTION_DELETE,
      IPC.AI_CONNECTION_SAVE_KEY,
      IPC.AI_CONNECTION_DELETE_KEY,
      IPC.AI_CONNECTION_HAS_KEY,
      IPC.AI_CONNECTION_SET_ACTIVE,
      IPC.AI_CONNECTION_LIST_MODELS,
      IPC.AI_CONNECTION_VALIDATE,
    ].sort());
  });

  it('lists account-managed connections without exposing their key', async () => {
    const { handlers } = harness();
    const result = await handlers.get(IPC.AI_CONNECTION_LIST)?.({});
    expect(JSON.stringify(result)).not.toContain('secret-token');
    expect(result).toEqual([expect.objectContaining({ managedBy: 'account', hasKey: true })]);
  });

  it('validates a connection and persists discovered capabilities', async () => {
    const { handlers, store, assistant } = harness();
    const result = await handlers.get(IPC.AI_CONNECTION_VALIDATE)?.({}, 'connection-1');
    expect(assistant.validateConnection).toHaveBeenCalledOnce();
    expect(store.loadKey).toHaveBeenCalledWith('connection-1');
    expect(store.updateCapabilities).toHaveBeenCalledWith('connection-1', {
      modelDiscovery: 'available',
      lastValidatedAt: 100,
    });
    expect(result).toEqual(expect.objectContaining({ ok: true }));
  });
});
