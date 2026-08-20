import { useEffect } from 'react';
import { ConnectedAppsScreen } from '@musefold/product-ui';
import { useAccountStore } from '../../account/store';
import { useCloudConnectionsStore } from '../cloud-connections-store';

export function ConnectedAppsSection() {
  const account = useAccountStore((state) => state.status);
  const connections = useCloudConnectionsStore((state) => state.connections);
  const loading = useCloudConnectionsStore((state) => state.loading);
  const loadError = useCloudConnectionsStore((state) => state.error);
  const load = useCloudConnectionsStore((state) => state.load);
  const clear = useCloudConnectionsStore((state) => state.clear);
  const update = useCloudConnectionsStore((state) => state.update);
  const revoke = useCloudConnectionsStore((state) => state.revoke);
  const available = account.loggedIn && account.isDefaultServer;

  useEffect(() => {
    if (!available) {
      clear();
      return;
    }
    void load().catch(() => undefined);
  }, [available, clear, load]);

  const emptyLabel = !account.loggedIn
    ? '登录 Musefold 账号后可管理 Cloud MCP 连接'
    : !account.isDefaultServer
      ? '自定义账号服务器暂不支持 Cloud MCP 连接管理'
      : '还没有连接 AI 客户端';

  return (
    <ConnectedAppsScreen
      testId="connected-apps-screen"
      items={connections.items}
      loading={loading}
      loadError={loadError}
      emptyLabel={emptyLabel}
      onUpdate={async (id, input) => {
        await update(id, input);
      }}
      onRevoke={async (id) => {
        await revoke(id);
      }}
    />
  );
}
