import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountGateway } from '@musefold/domain';
import type { McpConnection, McpConnectionPage } from '@musefold/contracts';
import { desktopGateway } from '../../../runtime';
import {
  setCloudConnectionsGatewayForTests,
  useCloudConnectionsStore,
} from '../cloud-connections-store';

const EMPTY_CONNECTIONS: McpConnectionPage = { items: [] };

function makeConnection(patch: Partial<McpConnection> = {}): McpConnection {
  return {
    id: 'conn-1',
    clientName: 'Claude',
    scopes: ['prompts:read'],
    mode: 'ask_each_time',
    maxPointsPerGeneration: 10,
    maxPointsPerDay: 100,
    spentPointsToday: 0,
    reservedPointsToday: 0,
    status: 'active',
    createdAt: '2026-08-20T00:00:00.000Z',
    lastUsedAt: null,
    ...patch,
  };
}

function unusedAccountMethod(name: string) {
  return vi.fn(async () => {
    throw new Error(`${name} 不应被 cloud-connections-store 调用`);
  });
}

function createFakeGateway(): AccountGateway {
  return {
    getAccount: unusedAccountMethod('getAccount'),
    login: unusedAccountMethod('login'),
    register: unusedAccountMethod('register'),
    redeem: unusedAccountMethod('redeem'),
    logout: unusedAccountMethod('logout'),
    listConnections: vi.fn(),
    updateConnection: vi.fn(),
    revokeConnection: vi.fn(),
  };
}

function resetStore(
  patch: Partial<ReturnType<typeof useCloudConnectionsStore.getState>> = {},
): void {
  useCloudConnectionsStore.setState({
    connections: EMPTY_CONNECTIONS,
    loaded: false,
    loading: false,
    error: null,
    ...patch,
  });
}

let gateway: AccountGateway;

beforeEach(() => {
  vi.clearAllMocks();
  gateway = createFakeGateway();
  setCloudConnectionsGatewayForTests(gateway);
  resetStore();
});

afterEach(() => {
  setCloudConnectionsGatewayForTests(desktopGateway);
});

describe('cloud-connections-store AccountGateway wiring', () => {
  it('load 调用 listConnections 并写入连接页', async () => {
    const page: McpConnectionPage = { items: [makeConnection()] };
    vi.mocked(gateway.listConnections).mockResolvedValue(page);

    const result = await useCloudConnectionsStore.getState().load();

    expect(gateway.listConnections).toHaveBeenCalledOnce();
    expect(result).toEqual(page);
    expect(useCloudConnectionsStore.getState()).toMatchObject({
      connections: page,
      loaded: true,
      loading: false,
      error: null,
    });
  });

  it('load 失败时把错误写入 state 并原样抛出', async () => {
    vi.mocked(gateway.listConnections).mockRejectedValue(new Error('列表失败'));

    await expect(useCloudConnectionsStore.getState().load()).rejects.toThrow('列表失败');

    expect(useCloudConnectionsStore.getState()).toMatchObject({
      loaded: true,
      loading: false,
      error: '列表失败',
    });
  });

  it('update 调用 updateConnection 并回写连接页', async () => {
    const page: McpConnectionPage = {
      items: [makeConnection({ mode: 'auto_with_limits' })],
    };
    vi.mocked(gateway.updateConnection).mockResolvedValue(page);

    const result = await useCloudConnectionsStore.getState().update('conn-1', {
      mode: 'auto_with_limits',
    });

    expect(gateway.updateConnection).toHaveBeenCalledWith('conn-1', {
      mode: 'auto_with_limits',
    });
    expect(result).toEqual(page);
    expect(useCloudConnectionsStore.getState()).toMatchObject({
      connections: page,
      loaded: true,
      error: null,
    });
  });

  it('update 失败时把错误写入 state 并原样抛出', async () => {
    vi.mocked(gateway.updateConnection).mockRejectedValue(new Error('策略被拒'));

    await expect(
      useCloudConnectionsStore.getState().update('conn-1', { suspended: true }),
    ).rejects.toThrow('策略被拒');

    expect(useCloudConnectionsStore.getState().error).toBe('策略被拒');
  });

  it('revoke 先 revokeConnection 再 listConnections', async () => {
    const remaining: McpConnectionPage = { items: [] };
    vi.mocked(gateway.revokeConnection).mockResolvedValue(undefined);
    vi.mocked(gateway.listConnections).mockResolvedValue(remaining);

    await useCloudConnectionsStore.getState().revoke('conn-1');

    expect(gateway.revokeConnection).toHaveBeenCalledWith('conn-1');
    expect(gateway.listConnections).toHaveBeenCalledOnce();
    expect(vi.mocked(gateway.revokeConnection).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(gateway.listConnections).mock.invocationCallOrder[0],
    );
    expect(useCloudConnectionsStore.getState()).toMatchObject({
      connections: remaining,
      loaded: true,
      error: null,
    });
  });

  it('revoke 失败时不再 list，错误写入 state', async () => {
    vi.mocked(gateway.revokeConnection).mockRejectedValue(new Error('撤销失败'));

    await expect(useCloudConnectionsStore.getState().revoke('conn-1')).rejects.toThrow(
      '撤销失败',
    );

    expect(gateway.listConnections).not.toHaveBeenCalled();
    expect(useCloudConnectionsStore.getState().error).toBe('撤销失败');
  });
});
