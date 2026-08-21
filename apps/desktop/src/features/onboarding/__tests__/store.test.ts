// TASK-SET-04 首启引导流状态机单测 —— 门控/skip/finish/generateFirstImage 分支
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  createProvider: vi.fn(),
  saveKey: vi.fn(),
  validate: vi.fn(),
  setActive: vi.fn(),
  loadProviders: vi.fn(),
  openWebLogin: vi.fn(),
  setView: vi.fn(),
}));

vi.mock('../../../lib/ipc', () => ({
  default: {
    provider: { openWebLogin: mocks.openWebLogin },
  },
}));

vi.mock('../../../runtime', () => ({
  desktopGateway: { generateImage: mocks.generate },
}));

let genState: {
  providersLoaded: boolean;
  providers: { id: string; type?: string }[];
  createProvider: typeof mocks.createProvider;
  saveKey: typeof mocks.saveKey;
  validate: typeof mocks.validate;
  setActive: typeof mocks.setActive;
  loadProviders: typeof mocks.loadProviders;
};

vi.mock('../../generation/store', () => ({
  useGenerationStore: {
    getState: () => genState,
  },
}));

vi.mock('../../../stores/app', () => ({
  useAppStore: {
    getState: () => ({ setView: mocks.setView }),
  },
}));

import { useOnboardingStore } from '../store';
import { ONBOARDING_PREFERENCES_KEY } from '../../../lib/onboarding-preferences';
import { persistStateOf } from '../../../lib/zustand-persist';

function onboardedPersist(): boolean {
  return persistStateOf<{ onboarded?: boolean }>(localStorage.getItem(ONBOARDING_PREFERENCES_KEY))?.onboarded === true;
}

function installLocalStorage(): void {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  installLocalStorage();
  localStorage.clear();
  genState = {
    providersLoaded: false,
    providers: [],
    createProvider: mocks.createProvider,
    saveKey: mocks.saveKey,
    validate: mocks.validate,
    setActive: mocks.setActive,
    loadProviders: mocks.loadProviders,
  };
  mocks.loadProviders.mockResolvedValue(undefined);
  mocks.openWebLogin.mockResolvedValue({ opened: true });
  useOnboardingStore.setState({
    onboarded: false,
    forced: false,
    step: 1,
    track: null,
    accountStage: 'choose',
    accountBusy: false,
    accountError: null,
    accountQuota: null,
    textConnectionId: null,
    textValidation: null,
    alsoConfigureText: false,
    doubaoWindowOpened: false,
    presetId: 'tvt',
    apiKey: '',
    providerId: null,
    saving: false,
    validating: false,
    validation: null,
    ratioId: '1:1',
    quality: 'medium',
    generating: false,
    generateError: null,
    generatedImagePath: null,
  });
});

describe('isVisible gating', () => {
  it('stays hidden while providers have not loaded yet (avoids flash)', () => {
    genState.providersLoaded = false;
    genState.providers = [];
    expect(useOnboardingStore.getState().isVisible()).toBe(false);
  });

  it('shows once providers have loaded and the list is empty', () => {
    genState.providersLoaded = true;
    genState.providers = [];
    expect(useOnboardingStore.getState().isVisible()).toBe(true);
  });

  it('stays hidden when a provider already exists', () => {
    genState.providersLoaded = true;
    genState.providers = [{ id: 'p1' }];
    expect(useOnboardingStore.getState().isVisible()).toBe(false);
  });

  it('stays hidden once onboarded is set, even with zero providers', () => {
    genState.providersLoaded = true;
    genState.providers = [];
    useOnboardingStore.setState({ onboarded: true });
    expect(useOnboardingStore.getState().isVisible()).toBe(false);
  });

  it('forced overrides every other gate', () => {
    genState.providersLoaded = true;
    genState.providers = [{ id: 'p1' }];
    useOnboardingStore.setState({ onboarded: true, forced: true });
    expect(useOnboardingStore.getState().isVisible()).toBe(true);
  });

  it('stays visible after the selected flow creates its provider', () => {
    genState.providersLoaded = true;
    genState.providers = [{ id: 'p1', type: 'doubao-web' }];
    useOnboardingStore.setState({ step: 3, providerId: 'p1' });
    expect(useOnboardingStore.getState().isVisible()).toBe(true);
  });
});

describe('doubao login', () => {
  it('opens the dedicated web login window', async () => {
    await useOnboardingStore.getState().openDoubaoLogin();

    expect(mocks.openWebLogin).toHaveBeenCalledOnce();
    expect(useOnboardingStore.getState().doubaoWindowOpened).toBe(true);
  });

  it('creates, validates, and activates the Doubao provider after login', async () => {
    mocks.createProvider.mockResolvedValue({ id: 'doubao-1' });
    mocks.validate.mockResolvedValue({ ok: true, message: '豆包网页已登录' });
    mocks.setActive.mockResolvedValue(undefined);

    await useOnboardingStore.getState().confirmDoubaoLogin();

    expect(mocks.createProvider).toHaveBeenCalledWith(expect.objectContaining({
      type: 'doubao-web',
      model: 'seedream-4.5',
    }));
    expect(mocks.validate).toHaveBeenCalledWith('doubao-1');
    expect(mocks.loadProviders).toHaveBeenCalledOnce();
    expect(mocks.setActive).toHaveBeenCalledWith('doubao-1');
    expect(useOnboardingStore.getState().step).toBe(3);
  });

  it('reuses an existing Doubao provider instead of creating a duplicate', async () => {
    genState.providers = [{ id: 'doubao-existing', type: 'doubao-web' }];
    mocks.validate.mockResolvedValue({ ok: true, message: '豆包网页已登录' });

    await useOnboardingStore.getState().confirmDoubaoLogin();

    expect(mocks.createProvider).not.toHaveBeenCalled();
    expect(mocks.validate).toHaveBeenCalledWith('doubao-existing');
  });
});

describe('skip / finish', () => {
  it('skip sets onboarded, persists the sentinel, and routes to library', () => {
    useOnboardingStore.getState().skip();
    expect(useOnboardingStore.getState().onboarded).toBe(true);
    expect(onboardedPersist()).toBe(true);
    expect(mocks.setView).toHaveBeenCalledWith('library');
  });

  // v0.3.3：完成引导直接进工作台开卷（skip 仍回提示词库，行为不变）。
  it('finish sets onboarded, persists the sentinel, and routes to the workbench', () => {
    useOnboardingStore.getState().finish();
    expect(useOnboardingStore.getState().onboarded).toBe(true);
    expect(onboardedPersist()).toBe(true);
    expect(mocks.setView).toHaveBeenCalledWith('generate');
  });

  it('never writes the API key itself to localStorage', () => {
    useOnboardingStore.setState({ apiKey: 'sk-should-not-leak' });
    useOnboardingStore.getState().skip();
    const dump = JSON.stringify(Object.entries(localStorage));
    expect(dump).not.toContain('sk-should-not-leak');
  });
});

describe('connect', () => {
  it('creates a provider, saves the key, clears apiKey, and advances to step 3', async () => {
    mocks.createProvider.mockResolvedValue({ id: 'new-provider-1' });
    useOnboardingStore.setState({ apiKey: 'sk-test-key', presetId: 'tvt' });
    mocks.validate.mockResolvedValue({ ok: true, message: 'ok' });
    mocks.setActive.mockResolvedValue(undefined);

    await useOnboardingStore.getState().connect();

    expect(mocks.createProvider).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'openai-compatible', isActive: true }),
    );
    expect(mocks.saveKey).toHaveBeenCalledWith('new-provider-1', 'sk-test-key');
    expect(useOnboardingStore.getState().apiKey).toBe('');
    expect(useOnboardingStore.getState().providerId).toBe('new-provider-1');
    expect(useOnboardingStore.getState().step).toBe(3);
  });

  it('is a no-op when apiKey is blank', async () => {
    useOnboardingStore.setState({ apiKey: '   ' });
    await useOnboardingStore.getState().connect();
    expect(mocks.createProvider).not.toHaveBeenCalled();
  });

  it('surfaces a failure as a validation banner instead of throwing', async () => {
    mocks.createProvider.mockRejectedValue(new Error('创建失败'));
    useOnboardingStore.setState({ apiKey: 'sk-test-key' });

    await useOnboardingStore.getState().connect();

    expect(useOnboardingStore.getState().saving).toBe(false);
    expect(useOnboardingStore.getState().validation).toEqual(
      expect.objectContaining({ ok: false, message: '创建失败' }),
    );
  });
});

describe('validate / retryValidate', () => {
  it('setActive is called only when validation succeeds', async () => {
    useOnboardingStore.setState({ providerId: 'p1' });
    mocks.validate.mockResolvedValue({ ok: false, code: 'AUTH', message: '401' });

    await useOnboardingStore.getState().validate();

    expect(mocks.setActive).not.toHaveBeenCalled();
    expect(useOnboardingStore.getState().validation).toEqual({ ok: false, code: 'AUTH', message: '401' });
    expect(useOnboardingStore.getState().validating).toBe(false);
  });

  it('setActive is called after a successful validation', async () => {
    useOnboardingStore.setState({ providerId: 'p1' });
    mocks.validate.mockResolvedValue({ ok: true, message: 'ok' });
    mocks.setActive.mockResolvedValue(undefined);

    await useOnboardingStore.getState().validate();

    expect(mocks.setActive).toHaveBeenCalledWith('p1');
  });
});

describe('generateFirstImage', () => {
  it('stores the image path on success', async () => {
    useOnboardingStore.setState({ providerId: 'p1' });
    mocks.generate.mockResolvedValue({ historyId: 'h1', status: 'success', imagePath: '/tmp/h1.png' });

    await useOnboardingStore.getState().generateFirstImage();

    expect(useOnboardingStore.getState().generatedImagePath).toBe('/tmp/h1.png');
    expect(useOnboardingStore.getState().generating).toBe(false);
    expect(useOnboardingStore.getState().generateError).toBeNull();
  });

  it('captures a structured error on failure without throwing', async () => {
    useOnboardingStore.setState({ providerId: 'p1' });
    mocks.generate.mockResolvedValue({
      historyId: 'h1',
      status: 'failed',
      error: { code: 'AUTH', message: '401' },
    });

    await useOnboardingStore.getState().generateFirstImage();

    expect(useOnboardingStore.getState().generateError).toEqual({ code: 'AUTH', message: '401' });
    expect(useOnboardingStore.getState().generatedImagePath).toBeNull();
  });

  it('is a no-op without a providerId', async () => {
    useOnboardingStore.setState({ providerId: null });
    await useOnboardingStore.getState().generateFirstImage();
    expect(mocks.generate).not.toHaveBeenCalled();
  });
});
