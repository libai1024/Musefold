import { describe, expect, it, vi } from 'vitest';
import type { AutomationRouteContext } from '@musefold/automation-server';
import type { AccountStatus } from '@shared/types/account';
import type { ProviderConfig } from '@shared/types/models';

vi.mock('electron', () => ({ app: { focus: vi.fn() } }));
vi.mock('../../account', () => ({ getAccountService: vi.fn() }));
vi.mock('../core-instance', () => ({ getMusefoldCore: vi.fn() }));
vi.mock('../automation-local', () => ({ createElectronLocalAdminOps: vi.fn() }));
vi.mock('../window', () => ({ getMainWindow: vi.fn() }));

import { createAutomationSetupRoutes } from '../automation-setup';

const account: AccountStatus = {
  loggedIn: true,
  username: 'must-not-leak',
  serverUrl: 'https://private.example',
  isDefaultServer: false,
  quota: { value: 123, at: 1 },
  estImagesRemaining: 4,
  deviceTokenSuffix: 'abcd',
  health: 'ok',
  notices: [],
};

function provider(patch: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'provider-ready',
    name: '可用中转站',
    type: 'openai-compatible',
    baseUrl: 'https://secret-host.example/v1',
    model: 'gpt-image-2',
    hasKey: true,
    keySuffix: 'zz99',
    isActive: true,
    managedBy: null,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

function context(body?: unknown, params: Record<string, string> = {}): AutomationRouteContext {
  return {
    body,
    params,
    request: {} as AutomationRouteContext['request'],
    response: {} as AutomationRouteContext['response'],
    url: new URL('http://127.0.0.1/v1/setup'),
    json: vi.fn(),
  };
}

function fixture(providers: ProviderConfig[] = [provider()]) {
  const openSetup = vi.fn();
  const setActiveProvider = vi.fn();
  const providerChanged = vi.fn();
  const routes = createAutomationSetupRoutes({
    accountStatus: () => account,
    listProviders: () => providers,
    setActiveProvider,
    openSetup,
    providerChanged,
  });
  return { routes, openSetup, setActiveProvider, providerChanged };
}

describe('automation safe setup routes', () => {
  it('status only returns redacted readiness', async () => {
    const { routes } = fixture();
    const result = await routes['GET /v1/setup/status'](context());
    expect(result).toMatchObject({
      account: { configured: true, health: 'ok', serverKind: 'custom' },
      activeProviderId: 'provider-ready',
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('must-not-leak');
    expect(serialized).not.toContain('private.example');
    expect(serialized).not.toContain('secret-host.example');
    expect(serialized).not.toContain('zz99');
  });

  it('opens native provider setup with non-secret validated draft', async () => {
    const { routes, openSetup } = fixture();
    const result = await routes['POST /v1/setup/open'](context({
      kind: 'provider',
      draft: { name: '我的站', type: 'openai-compatible', baseUrl: 'https://relay.example/v1', model: 'image-v2' },
    }));
    expect(result).toMatchObject({ opened: true, kind: 'provider' });
    expect(openSetup).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'provider',
      draft: { name: '我的站', type: 'openai-compatible', baseUrl: 'https://relay.example/v1', model: 'image-v2' },
    }));
  });

  it('rejects credentials and unsafe URLs before opening UI', async () => {
    const { routes, openSetup } = fixture();
    let credentialError: unknown;
    let urlError: unknown;
    try {
      await routes['POST /v1/setup/open'](context({
        kind: 'account',
        password: 'should-never-enter-control-plane',
      }));
    } catch (error) { credentialError = error; }
    try {
      await routes['POST /v1/setup/open'](context({
        kind: 'provider',
        draft: { baseUrl: 'https://user:pass@relay.example/v1' },
      }));
    } catch (error) { urlError = error; }
    expect(credentialError).toMatchObject({ code: 'CREDENTIALS_NOT_ACCEPTED' });
    expect(urlError).toMatchObject({ code: 'INVALID_PARAMS' });
    expect(openSetup).not.toHaveBeenCalled();
  });

  it('only activates an existing provider with stored credentials', async () => {
    const ready = fixture();
    const selected = await ready.routes['POST /v1/setup/providers/:id/activate'](context({}, { id: 'provider-ready' }));
    expect(selected).toMatchObject({ selected: { id: 'provider-ready', isActive: true } });
    expect(ready.setActiveProvider).toHaveBeenCalledWith('provider-ready');
    expect(ready.providerChanged).toHaveBeenCalledWith('provider-ready');

    const missingKey = fixture([provider({ id: 'provider-empty', hasKey: false })]);
    let missingKeyError: unknown;
    try {
      await missingKey.routes['POST /v1/setup/providers/:id/activate'](
        context({}, { id: 'provider-empty' }),
      );
    } catch (error) { missingKeyError = error; }
    expect(missingKeyError).toMatchObject({ code: 'PROVIDER_NOT_READY' });
  });
});
