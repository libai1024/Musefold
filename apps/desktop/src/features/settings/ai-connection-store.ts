import { create } from 'zustand';
import type {
  AiConnectionPreset,
  AiConnectionProfile,
  AiConnectionValidationResult,
  AiTextModelInfo,
  CreateAiConnectionInput,
  UpdateAiConnectionInput,
} from '@musefold/desktop-contracts/ai';
import type { DesktopExtras } from '@musefold/desktop-contracts/desktop-extras';
import { desktopGateway } from '../../runtime';
import { aiConnectionErrorMessage } from './ai-connection-errors';

export type AiConnectionIO = Pick<
  DesktopExtras,
  | 'listAiConnectionPresets'
  | 'listAiConnections'
  | 'createAiConnection'
  | 'updateAiConnection'
  | 'deleteAiConnection'
  | 'saveAiConnectionKey'
  | 'deleteAiConnectionKey'
  | 'setActiveAiConnection'
  | 'listAiConnectionModels'
  | 'validateAiConnection'
>;

let aiConnectionIO: AiConnectionIO = desktopGateway;

export function setAiConnectionIOForTests(next: AiConnectionIO): void {
  aiConnectionIO = next;
}

export function resetAiConnectionIOForTests(): void {
  aiConnectionIO = desktopGateway;
}

export type AiConnectionTestState =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'success'; result: AiConnectionValidationResult }
  | { state: 'failed'; message: string };

interface AiConnectionSettingsState {
  connections: AiConnectionProfile[];
  presets: AiConnectionPreset[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  dialogOpen: boolean;
  editingConnection: AiConnectionProfile | null;
  dialogPresetId: AiConnectionPreset['id'] | null;
  testStatus: Record<string, AiConnectionTestState>;
  load: () => Promise<void>;
  openDialog: (
    connection?: AiConnectionProfile | null,
    presetId?: AiConnectionPreset['id'],
  ) => void;
  closeDialog: () => void;
  createConnection: (input: CreateAiConnectionInput) => Promise<AiConnectionProfile>;
  updateConnection: (id: string, patch: UpdateAiConnectionInput) => Promise<AiConnectionProfile>;
  deleteConnection: (id: string) => Promise<void>;
  saveKey: (id: string, apiKey: string) => Promise<AiConnectionProfile>;
  deleteKey: (id: string) => Promise<AiConnectionProfile>;
  setActive: (id: string) => Promise<AiConnectionProfile>;
  listModels: (id: string) => Promise<AiTextModelInfo[]>;
  validate: (id: string) => Promise<AiConnectionValidationResult>;
}

function messageOf(error: unknown, fallback: string): string {
  return aiConnectionErrorMessage(error, fallback);
}

function replaceConnection(
  connections: AiConnectionProfile[],
  updated: AiConnectionProfile,
): AiConnectionProfile[] {
  return connections.map((connection) =>
    connection.id === updated.id
      ? updated
      : {
          ...connection,
          ...(updated.isActive ? { isActive: false } : {}),
        },
  );
}

export const useAiConnectionStore = create<AiConnectionSettingsState>((set, get) => ({
  connections: [],
  presets: [],
  loaded: false,
  loading: false,
  error: null,
  dialogOpen: false,
  editingConnection: null,
  dialogPresetId: null,
  testStatus: {},

  load: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const [presets, connections] = await Promise.all([
        aiConnectionIO.listAiConnectionPresets(),
        aiConnectionIO.listAiConnections(),
      ]);
      set({ presets, connections, loaded: true });
    } catch (error) {
      set({ error: messageOf(error, 'AI 连接读取失败'), loaded: true });
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  openDialog: (connection, presetId) => {
    if (connection?.managedBy === 'account') return;
    set({
      dialogOpen: true,
      editingConnection: connection ?? null,
      dialogPresetId: connection ? null : (presetId ?? null),
    });
  },
  closeDialog: () => set({ dialogOpen: false, editingConnection: null, dialogPresetId: null }),

  createConnection: async (input) => {
    const created = await aiConnectionIO.createAiConnection(input);
    set((state) => ({
      connections: created.isActive
        ? [...state.connections.map((connection) => ({ ...connection, isActive: false })), created]
        : [...state.connections, created],
    }));
    return created;
  },

  updateConnection: async (id, patch) => {
    if (get().connections.find((connection) => connection.id === id)?.managedBy === 'account') {
      throw new Error('账号 Agent 模型由 Musefold 固定管理');
    }
    const updated = await aiConnectionIO.updateAiConnection(id, patch);
    set((state) => ({ connections: replaceConnection(state.connections, updated) }));
    return updated;
  },

  deleteConnection: async (id) => {
    await aiConnectionIO.deleteAiConnection(id);
    const connections = await aiConnectionIO.listAiConnections();
    set((state) => {
      const testStatus = { ...state.testStatus };
      delete testStatus[id];
      return { connections, testStatus };
    });
  },

  saveKey: async (id, apiKey) => {
    const updated = await aiConnectionIO.saveAiConnectionKey(id, apiKey);
    set((state) => ({ connections: replaceConnection(state.connections, updated) }));
    return updated;
  },

  deleteKey: async (id) => {
    const updated = await aiConnectionIO.deleteAiConnectionKey(id);
    set((state) => ({
      connections: replaceConnection(state.connections, updated),
      testStatus: { ...state.testStatus, [id]: { state: 'idle' } },
    }));
    return updated;
  },

  setActive: async (id) => {
    const updated = await aiConnectionIO.setActiveAiConnection(id);
    set((state) => ({ connections: replaceConnection(state.connections, updated) }));
    return updated;
  },

  listModels: (id) => aiConnectionIO.listAiConnectionModels(id),

  validate: async (id) => {
    set((state) => ({
      testStatus: { ...state.testStatus, [id]: { state: 'testing' } },
    }));
    try {
      const result = await aiConnectionIO.validateAiConnection(id);
      set((state) => ({
        connections: state.connections.map((connection) =>
          connection.id === id ? { ...connection, capabilities: result.capabilities } : connection,
        ),
        testStatus: {
          ...state.testStatus,
          [id]: result.ok
            ? { state: 'success', result }
            : { state: 'failed', message: result.message },
        },
      }));
      return result;
    } catch (error) {
      const message = messageOf(error, '连接测试失败');
      set((state) => ({
        testStatus: { ...state.testStatus, [id]: { state: 'failed', message } },
      }));
      throw error;
    }
  },
}));
