// 设置 → Cloud MCP 已连接应用。
// list / update / revoke 走 AccountGateway（desktopGateway），作为账号域样板。
// 账号 login/status 与 cloudSync 仍不经本 store：前者有损映射，后者是桌面独有域。

import { create } from 'zustand';
import type { AccountGateway } from '@musefold/domain';
import type {
  McpConnectionPage,
  UpdateMcpConnection,
} from '@musefold/contracts';
import { desktopGateway } from '../../runtime';

const EMPTY_CONNECTIONS: McpConnectionPage = { items: [] };

let accountGateway: AccountGateway = desktopGateway;

/** 测试替换 AccountGateway；生产保持 desktopGateway 单例。 */
export function setCloudConnectionsGatewayForTests(next: AccountGateway): void {
  accountGateway = next;
}

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
      const connections = await accountGateway.listConnections();
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
      const connections = await accountGateway.updateConnection(id, input);
      set({ connections, loaded: true, error: null });
      return connections;
    } catch (error) {
      set({ error: errorMessage(error, '连接策略更新失败') });
      throw error;
    }
  },

  revoke: async (id) => {
    try {
      // 现网：revoke 后再 list，刷新整页连接。
      await accountGateway.revokeConnection(id);
      const connections = await accountGateway.listConnections();
      set({ connections, loaded: true, error: null });
    } catch (error) {
      set({ error: errorMessage(error, '撤销 Cloud MCP 连接失败') });
      throw error;
    }
  },
}));
