import { ConnectedAppsScreen } from '@musefold/product-ui';
import type { McpConnectionPage } from '@musefold/contracts';
import type { WebGateway } from '../runtime';

export function ConnectionsView({
  gateway,
  connections,
  onConnectionsChange,
  embedded = false,
  showHeading = true,
}: {
  gateway: WebGateway;
  connections: McpConnectionPage;
  onConnectionsChange: (next: McpConnectionPage) => void;
  embedded?: boolean;
  showHeading?: boolean;
}) {
  const screen = (
    <ConnectedAppsScreen
      testId="connected-apps-screen"
      items={connections.items}
      showHeading={showHeading}
      mcpServerUrl={`${window.location.origin}/api/musefold/mcp`}
      onUpdate={async (id, input) => onConnectionsChange(await gateway.updateConnection(id, input))}
      onRevoke={async (id) => {
        await gateway.revokeConnection(id);
        onConnectionsChange(await gateway.listConnections());
      }}
    />
  );

  if (embedded) return screen;

  return (
    <div className="page min-h-0 min-w-0 flex-1 overflow-y-auto px-[24px] pt-[20px] pb-[48px]">
      {screen}
    </div>
  );
}
