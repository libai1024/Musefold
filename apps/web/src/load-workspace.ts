import { collectGatewayPages, DEFAULT_WORKBENCH_SESSION_LIST_KEY } from '@musefold/product-ui';
import type { WebGateway } from './runtime';
import { WEB_HISTORY_LIST_KEY, WEB_LIBRARY_LIST_KEY } from './workspace-query-cache';

export async function loadWebWorkspace(gateway: WebGateway) {
  const requestedSessionId = new URLSearchParams(window.location.search).get('session');
  const [prompts, history, snapshotItems, workbenchPage] = await Promise.all([
    gateway.listPrompts({ ...WEB_LIBRARY_LIST_KEY }),
    gateway.listGenerationHistory({ ...WEB_HISTORY_LIST_KEY }),
    collectGatewayPages((cursor) =>
      gateway.listGenerationHistory({
        limit: 100,
        ...(cursor ? { cursor } : {}),
      }),
    ),
    gateway.listWorkbenchSessions({ ...DEFAULT_WORKBENCH_SESSION_LIST_KEY }),
  ]);
  const selectedSummary =
    workbenchPage.items.find((item) => item.id === requestedSessionId) ??
    workbenchPage.items[0] ??
    null;
  const selected = selectedSummary ? await gateway.getWorkbenchSession(selectedSummary.id) : null;
  const sessionJobs = selected
    ? snapshotItems.filter((item) => item.sessionId === selected.id)
    : [];

  return {
    prompts,
    history,
    snapshotItems,
    workbenchPage,
    selected,
    sessionJobs,
  };
}
