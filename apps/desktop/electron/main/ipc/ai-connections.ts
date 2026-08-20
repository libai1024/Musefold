import { ipcMain, type IpcMain } from 'electron';
import { IPC } from '@musefold/desktop-contracts/ipc';
import type {
  AiConnectionProfile,
  CreateAiConnectionInput,
  UpdateAiConnectionInput,
} from '@musefold/desktop-contracts/ai';
import {
  AI_CONNECTION_PRESETS,
  AiConnectionStore,
  getAiConnectionStore,
} from '../../ai/connection-store';
import {
  classifyAiError,
  OpenAiCompatibleAssistant,
} from '../../ai/openai-compatible-assistant';

interface AiConnectionIpcTarget {
  handle: IpcMain['handle'];
}

interface AiConnectionAssistant {
  listModels: OpenAiCompatibleAssistant['listModels'];
  validateConnection: OpenAiCompatibleAssistant['validateConnection'];
}

export interface AiConnectionHandlerDependencies {
  target?: AiConnectionIpcTarget;
  store?: AiConnectionStore;
  createAssistant?: (profile: AiConnectionProfile, apiKey: string) => AiConnectionAssistant;
  now?: () => number;
}

function localErrorMessage(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  return /不存在|尚未配置|不能为空|不能超过|只支持|不能包含/.test(error.message)
    ? error.message
    : null;
}

export function registerAiConnectionHandlers(dependencies: AiConnectionHandlerDependencies = {}): void {
  const target = dependencies.target ?? ipcMain;
  const store = dependencies.store ?? getAiConnectionStore();
  const now = dependencies.now ?? Date.now;
  const createAssistant = dependencies.createAssistant ?? ((profile, apiKey) => (
    new OpenAiCompatibleAssistant({ connection: profile, apiKey })
  ));
  const assistantFor = (id: string) => {
    const profile = store.require(id);
    return { profile, assistant: createAssistant(profile, store.loadKey(id)) };
  };

  target.handle(IPC.AI_CONNECTION_LIST_PRESETS, () => structuredClone(AI_CONNECTION_PRESETS));
  target.handle(IPC.AI_CONNECTION_LIST, () => store.list());
  target.handle(IPC.AI_CONNECTION_CREATE, (_event, input: CreateAiConnectionInput) => store.create(input));
  target.handle(IPC.AI_CONNECTION_UPDATE, (_event, id: string, patch: UpdateAiConnectionInput) => store.update(id, patch));
  target.handle(IPC.AI_CONNECTION_DELETE, (_event, id: string) => {
    store.delete(id);
    return { ok: true as const };
  });
  target.handle(IPC.AI_CONNECTION_SAVE_KEY, (_event, id: string, apiKey: string) => store.saveKey(id, apiKey));
  target.handle(IPC.AI_CONNECTION_DELETE_KEY, (_event, id: string) => store.deleteKey(id));
  target.handle(IPC.AI_CONNECTION_HAS_KEY, (_event, id: string) => {
    const profile = store.require(id);
    return { hasKey: profile.hasKey, suffix: profile.keySuffix };
  });
  target.handle(IPC.AI_CONNECTION_SET_ACTIVE, (_event, id: string) => store.setActive(id));
  target.handle(IPC.AI_CONNECTION_LIST_MODELS, async (_event, id: string) => {
    const { assistant } = assistantFor(id);
    const models = await assistant.listModels();
    store.updateCapabilities(id, { modelDiscovery: 'available' });
    return models;
  });
  target.handle(IPC.AI_CONNECTION_VALIDATE, async (_event, id: string) => {
    try {
      const resolved = assistantFor(id);
      const validation = await resolved.assistant.validateConnection();
      const updated = store.updateCapabilities(id, {
        modelDiscovery: validation.modelDiscovery,
        lastValidatedAt: now(),
      });
      return {
        ok: true,
        message: validation.modelDiscovery === 'available'
          ? `连接成功，发现 ${validation.models.length} 个模型`
          : '连接成功，模型列表需手动维护',
        models: validation.models,
        capabilities: updated.capabilities,
      };
    } catch (error) {
      const existing = store.get(id);
      const classified = classifyAiError(error, undefined, {
        managedByAccount: existing?.managedBy === 'account',
      });
      return {
        ok: false,
        message: localErrorMessage(error) ?? classified.message,
        models: [],
        capabilities: existing?.capabilities ?? {
          modelDiscovery: 'unknown',
          supportedStructuredOutputModes: ['json-schema', 'json-object', 'json-text'],
          preferredStructuredOutputMode: 'json-schema',
          cancellation: true,
          streaming: false,
          lastValidatedAt: null,
        },
      };
    }
  });
}
