// Desktop-only host capabilities that have no cross-platform domain port.
// Renderer features import this boundary instead of the preload transport directly.

import type { Api } from '@musefold/desktop-contracts/ipc';
import api from '../lib/ipc';

export interface DesktopHostServices {
  readonly automation: Api['automation'];
  readonly designScheme: Api['designScheme'];
  readonly diagnostics: Api['diagnostics'];
  readonly image: Pick<Api['image'], 'pickLocal' | 'stageLocal'>;
  readonly log: Api['log'];
  readonly pet: Api['pet'];
  readonly provider: Pick<
    Api['provider'],
    | 'openWebLogin'
    | 'webLoginStart'
    | 'webLoginRefresh'
    | 'webLogout'
    | 'webLoginState'
    | 'setWebDeveloperVisible'
    | 'onWebLoginChanged'
    | 'webUsage'
    | 'webStatus'
  >;
  readonly share: Api['share'];
  readonly skillRuntime: Api['skillRuntime'];
  readonly system: Api['system'];
  readonly updater: Api['updater'];
  readonly window: Api['window'];
}

export const desktopHost = api as DesktopHostServices;
