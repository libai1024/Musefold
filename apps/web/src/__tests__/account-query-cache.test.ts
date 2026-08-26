import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  clearMusefoldUserQueryCache,
  createMusefoldQueryClient,
  musefoldQueryKeys,
} from '@musefold/product-ui';

describe('Web authenticated query cache', () => {
  it('reads account state from the shared query controller', () => {
    const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

    expect(appSource).toContain('useAccountQueryController');
    expect(appSource).toContain('onRefreshError: handleAccountRefreshError');
    expect(appSource).toContain('accountQuery.scheduleRefresh()');
    expect(appSource).not.toMatch(/useState<AccountSummary/);
    expect(appSource).not.toContain('setAccount(');
  });

  it('removes every user-owned domain while preserving unrelated cache', () => {
    const client = createMusefoldQueryClient();
    const userKeys = [
      musefoldQueryKeys.account.status,
      musefoldQueryKeys.library.list({ limit: 20 }),
      musefoldQueryKeys.history.list({ limit: 20 }),
      musefoldQueryKeys.workbench.list({ limit: 20 }),
      musefoldQueryKeys.connections.all,
    ] as const;
    for (const queryKey of userKeys) client.setQueryData(queryKey, { value: queryKey[0] });
    client.setQueryData(['public', 'catalog'], { value: 'keep' });

    clearMusefoldUserQueryCache(client);

    for (const queryKey of userKeys) expect(client.getQueryData(queryKey)).toBeUndefined();
    expect(client.getQueryData(['public', 'catalog'])).toEqual({ value: 'keep' });
  });
});
