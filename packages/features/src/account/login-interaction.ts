import type { MusefoldGateway } from '@musefold/platform';
import { queryKeys } from '@musefold/platform';
import type { QueryClient } from '@tanstack/react-query';
import { accountEpoch } from './account-session';

const observers = new WeakMap<QueryClient, { users: number; dispose(): void }>();

/** A shared explicit-interaction signal, never a heartbeat or visibility/poll
 * event. Both client and server throttle; untrusted synthetic events do not
 * extend a login. One listener set per QueryClient, regardless of status hooks. */
export function observeLoginInteraction(client: QueryClient, gateway: MusefoldGateway): () => void {
  if (typeof document === 'undefined' || !gateway.account?.touchLoginSession) return () => {};
  let observer = observers.get(client);
  if (!observer) {
    let lastSent = 0;
    let inFlight = false;
    const interact = (event: Event) => {
      if (
        !event.isTrusted ||
        document.visibilityState !== 'visible' ||
        inFlight ||
        Date.now() - lastSent < 300_000 ||
        !client.getQueryData(queryKeys.account.status())
      )
        return;
      const epoch = accountEpoch(client);
      lastSent = Date.now();
      inFlight = true;
      void gateway.account
        .touchLoginSession?.()
        .catch(() => {
          if (accountEpoch(client) === epoch)
            void client.invalidateQueries({ queryKey: queryKeys.account.status() });
        })
        .finally(() => {
          inFlight = false;
        });
    };
    document.addEventListener('pointerdown', interact, { passive: true });
    document.addEventListener('keydown', interact);
    observer = {
      users: 0,
      dispose: () => {
        document.removeEventListener('pointerdown', interact);
        document.removeEventListener('keydown', interact);
      },
    };
    observers.set(client, observer);
  }
  observer.users++;
  return () => {
    if (--observer.users === 0) {
      observer.dispose();
      observers.delete(client);
    }
  };
}
