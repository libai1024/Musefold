import { create } from 'zustand';
import type {
  McpConnectionPage,
  UpdateMcpConnection,
} from '@musefold/contracts';

const EMPTY_CONNECTIONS: McpConnectionPage = { items: [] };

interface CloudConnectionsState {
  connections: McpConnectionPage;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  clear: () => void;
  load: () => Promise<McpConnectionPage>;
  update: (id: string, input: UpdateMcpConnection) => Promise<McpConnectionPage>;
  revoke: (id: string) => Promise<void>;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** Desktop adapter state for the shared Cloud MCP connection screen. */
export const useCloudConnectionsStore = create<CloudConnectionsState>((set, get) => ({
  connections: EMPTY_CONNECTIONS,
  loaded: false,
  loading: false,
  error: null,

  clear: () => set({
    connections: EMPTY_CONNECTIONS,
    loaded: false,
    loading: false,
    error: null,
  }),

  load: async () => {
    if (get().loading) return get().connections;
    set({ loading: true, error: null });
    try {
      const connections = await window.api.cloudConnections.list();
      set({ connections, loaded: true });
      return connections;
    } catch (error) {
      set({
        loaded: true,
        error: errorMessage(error, '无法读取 Cloud MCP 连接'),
      });
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  update: async (id, input) => {
    try {
      const connections = await window.api.cloudConnections.update(id, input);
      set({ connections, loaded: true, error: null });
      return connections;
    } catch (error) {
      set({ error: errorMessage(error, '连接策略更新失败') });
      throw error;
    }
  },

  revoke: async (id) => {
    try {
      await window.api.cloudConnections.revoke(id);
      const connections = await window.api.cloudConnections.list();
      set({ connections, loaded: true, error: null });
    } catch (error) {
      set({ error: errorMessage(error, '撤销 Cloud MCP 连接失败') });
      throw error;
    }
  },
}));
