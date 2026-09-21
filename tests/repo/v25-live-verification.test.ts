import { describe, expect, it } from 'vitest';
import { validateLiveVerification } from '../../scripts/v25-live-verification.mjs';

const account = {
  MUSEFOLD_LIVE_E2E: '1',
  MUSEFOLD_E2E_USERNAME: 'fixture',
  MUSEFOLD_E2E_PASSWORD: 'fixture-password',
};
const generation = {
  ...account,
  MUSEFOLD_LIVE_GENERATION: '1',
  MUSEFOLD_E2E_IMAGE_API_KEY: 'fixture-key',
  MUSEFOLD_E2E_IMAGE_BASE_URL: 'https://relay.example/v1',
  MUSEFOLD_E2E_IMAGE_MODEL: 'explicit-model',
};

describe('real verification prerequisites', () => {
  it('fails instead of silently skipping a requested account verification', () => {
    expect(() => validateLiveVerification({})).toThrow('MUSEFOLD_LIVE_E2E=1 required');
    for (const name of ['MUSEFOLD_E2E_USERNAME', 'MUSEFOLD_E2E_PASSWORD']) {
      expect(() => validateLiveVerification({ ...account, [name]: ' ' })).toThrow(
        `${name} required`,
      );
    }
  });
  it('does not authorize a paid request merely because a key is present', () => {
    expect(validateLiveVerification({ ...generation, MUSEFOLD_LIVE_GENERATION: '' })).toEqual({
      generation: false,
      accountGeneration: false,
    });
  });
  it('requires explicit generation endpoint, model and key', () => {
    expect(validateLiveVerification(generation)).toEqual({
      generation: true,
      accountGeneration: false,
    });
    for (const name of [
      'MUSEFOLD_E2E_IMAGE_API_KEY',
      'MUSEFOLD_E2E_IMAGE_BASE_URL',
      'MUSEFOLD_E2E_IMAGE_MODEL',
    ]) {
      expect(() => validateLiveVerification({ ...generation, [name]: '' })).toThrow(
        `${name} required`,
      );
    }
  });
  it('requires separate account spending consent and an explicit cloud image model', () => {
    expect(validateLiveVerification(account)).toEqual({
      generation: false,
      accountGeneration: false,
    });
    expect(() =>
      validateLiveVerification({ ...account, MUSEFOLD_LIVE_ACCOUNT_GENERATION: '1' }),
    ).toThrow('MUSEFOLD_E2E_ACCOUNT_IMAGE_MODEL required');
    expect(
      validateLiveVerification({
        ...account,
        MUSEFOLD_LIVE_ACCOUNT_GENERATION: '1',
        MUSEFOLD_E2E_ACCOUNT_IMAGE_MODEL: 'cloud-fixture',
      }),
    ).toEqual({ generation: false, accountGeneration: true });
  });
  it.each([
    'http://relay.example/v1',
    'https://user:private-value@relay.example/v1',
    'https://relay.example/v1?key=private-value',
    'https://relay.example/v1#private-value',
    'private-value',
  ])('rejects an unsafe URL without echoing its contents', (url) => {
    let message = '';
    try {
      validateLiveVerification({ ...generation, MUSEFOLD_E2E_IMAGE_BASE_URL: url });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('MUSEFOLD_E2E_IMAGE_BASE_URL');
    expect(message).not.toContain('private-value');
  });
});
