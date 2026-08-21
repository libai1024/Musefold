import { ConnectedAppsScreen } from '@musefold/product-ui';
import type { McpConnectionPage } from '@musefold/contracts';
import type { WebGateway } from '../runtime';

export function ConnectionsView({
  gateway,
  connections,
  onConnectionsChange,
}: {
  gateway: WebGateway;
  connections: McpConnectionPage;
  onConnectionsChange: (next: McpConnectionPage) => void;
}) {
  return (
    <div className="page">
      <ConnectedAppsScreen
        testId="connected-apps-screen"
        items={connections.items}
        onUpdate={async (id, input) => onConnectionsChange(await gateway.updateConnection(id, input))}
        onRevoke={async (id) => {
          await gateway.revokeConnection(id);
          onConnectionsChange(await gateway.listConnections());
        }}
      />
    </div>
  );
}
