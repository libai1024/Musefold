import { describe, expect, it, vi } from 'vitest';
import type { AutomationRouteContext } from '@musefold/automation-server';
import type { ProviderConfig } from '@musefold/desktop-contracts/models';

vi.mock('electron', () => ({ app: { focus: vi.fn() } }));
vi.mock('../ipc-v25/account-domain', () => ({
  apiBase: vi.fn(() => 'https://private.example'),
  readSessionToken: vi.fn(async () => 'token'),
  fetchAccountStatus: vi.fn(async () => ({ loggedIn: true })),
}));
vi.mock('../core-instance', () => ({ getMusefoldCore: vi.fn() }));
vi.mock('../automation-local', () => ({ createElectronLocalAdminOps: vi.fn() }));
vi.mock('../window', () => ({ getMainWindow: vi.fn() }));

import {
  createAutomationSetupRoutes,
  createElectronAutomationSetupRoutes,
  type AutomationAccountSnapshot,
} from '../automation-setup';
import { fetchAccountStatus, readSessionToken } from '../ipc-v25/account-domain';
import { getMusefoldCore } from '../core-instance';

const account: AutomationAccountSnapshot = {
  loggedIn: true,
  health: 'ok',
  isDefaultServer: false,
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
    accountStatus: async () => account,
    listProviders: () => providers,
    setActiveProvider,
    openSetup,
    providerChanged,
  });
  return { routes, openSetup, setActiveProvider, providerChanged };
}

describe('automation safe setup routes', () => {
  it('cloud readiness is based on verified account identity, not a local API key', async () => {
    const cloud = provider({
      id: 'cloud-fixture',
      hasKey: false,
      type: 'musefold-cloud' as ProviderConfig['type'],
    });
    const activate = vi.fn(async () => {});
    const routes = createAutomationSetupRoutes({
      accountStatus: async () => account,
      listProviders: () => [cloud],
      setActiveProvider: activate,
      openSetup: () => {},
      providerChanged: () => {},
      cloudReadyProviderId: async () => cloud.id,
    });
    expect(await routes['GET /v1/providers'](context())).toMatchObject({
      providers: [{ id: cloud.id, available: true, hasKey: false }],
    });
    await routes['POST /v1/setup/providers/:id/activate'](context({}, { id: cloud.id }));
    expect(activate).toHaveBeenCalledWith(cloud.id);
    const blocked = fixture([cloud]);
    await expect(
      blocked.routes['POST /v1/setup/providers/:id/activate'](context({}, { id: cloud.id })),
    ).rejects.toMatchObject({ code: 'PROVIDER_NOT_READY' });
  });
  it('a cached token alone does not report healthy when the live account probe fails', async () => {
    vi.mocked(getMusefoldCore).mockReturnValue({
      providers: { list: () => [] },
    } as unknown as ReturnType<typeof getMusefoldCore>);
    vi.mocked(fetchAccountStatus).mockRejectedValueOnce(new Error('offline'));
    const routes = createElectronAutomationSetupRoutes();
    expect(await routes['GET /v1/setup/status'](context())).toMatchObject({
      account: { configured: true, health: 'unknown' },
    });
    expect(await routes['GET /v1/setup/status'](context())).toMatchObject({
      account: { configured: true, health: 'ok' },
    });
    vi.mocked(readSessionToken).mockResolvedValueOnce(null);
    expect(await routes['GET /v1/setup/status'](context())).toMatchObject({
      account: { configured: false, health: 'unknown' },
    });
  });
  it('status only returns redacted readiness', async () => {
    const { routes } = fixture();
    const result = await routes['GET /v1/setup/status'](context());
    expect(result).toMatchObject({
      account: { configured: true, health: 'ok', serverKind: 'custom' },
      activeProviderId: 'provider-ready',
    });
    const serialized = JSON.stringify(result);
    expect(result).not.toHaveProperty('account.userId');
    expect(serialized).not.toContain('must-not-leak');
    expect(serialized).not.toContain('private.example');
    expect(serialized).not.toContain('secret-host.example');
    expect(serialized).not.toContain('zz99');
  });

  it('opens native provider setup with non-secret validated draft', async () => {
    const { routes, openSetup } = fixture();
    const result = await routes['POST /v1/setup/open'](
      context({
        kind: 'provider',
        draft: {
          name: '我的站',
          type: 'openai-compatible',
          baseUrl: 'https://relay.example/v1',
          model: 'image-v2',
        },
      }),
    );
    expect(result).toMatchObject({ opened: true, kind: 'provider' });
    expect(openSetup).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'provider',
        draft: {
          name: '我的站',
          type: 'openai-compatible',
          baseUrl: 'https://relay.example/v1',
          model: 'image-v2',
        },
      }),
    );
  });

  it('rejects credentials and unsafe URLs before opening UI', async () => {
    const { routes, openSetup } = fixture();
    let credentialError: unknown;
    let urlError: unknown;
    try {
      await routes['POST /v1/setup/open'](
        context({
          kind: 'account',
          password: 'should-never-enter-control-plane',
        }),
      );
    } catch (error) {
      credentialError = error;
    }
    try {
      await routes['POST /v1/setup/open'](
        context({
          kind: 'provider',
          draft: { baseUrl: 'https://user:pass@relay.example/v1' },
        }),
      );
    } catch (error) {
      urlError = error;
    }
    expect(credentialError).toMatchObject({ code: 'CREDENTIALS_NOT_ACCEPTED' });
    expect(urlError).toMatchObject({ code: 'INVALID_PARAMS' });
    expect(openSetup).not.toHaveBeenCalled();
  });

  it('only activates an existing provider with stored credentials', async () => {
    const ready = fixture();
    const selected = await ready.routes['POST /v1/setup/providers/:id/activate'](
      context({}, { id: 'provider-ready' }),
    );
    expect(selected).toMatchObject({ selected: { id: 'provider-ready', isActive: true } });
    expect(ready.setActiveProvider).toHaveBeenCalledWith('provider-ready');
    expect(ready.providerChanged).toHaveBeenCalledWith('provider-ready');

    const missingKey = fixture([provider({ id: 'provider-empty', hasKey: false })]);
    let missingKeyError: unknown;
    try {
      await missingKey.routes['POST /v1/setup/providers/:id/activate'](
        context({}, { id: 'provider-empty' }),
      );
    } catch (error) {
      missingKeyError = error;
    }
    expect(missingKeyError).toMatchObject({ code: 'PROVIDER_NOT_READY' });
  });
});
