import { describe, expect, it } from 'vitest';
import {
  legacyPreferencesPatch,
  LEGACY_PREFERENCE_KEYS,
  LEGACY_PREFERENCE_MAX_BYTES,
} from '../legacy';

const at = '2026-09-21T02:00:00.000Z';
const persist = (state: unknown) => JSON.stringify({ state, version: 1 });
describe('v2.1 preference migration projection', () => {
  it('imports only bounded public notice IDs and leaves malformed legacy records untouched', () => {
    expect(LEGACY_PREFERENCE_KEYS).toContain('musefold:account-notices-read');
    expect(
      legacyPreferencesPatch({ 'musefold:account-notices-read': JSON.stringify(['n-ab12']) }, at),
    ).toEqual({ legacyAccountNoticeReadIds: ['n-ab12'] });
    for (const raw of [
      'not-json',
      JSON.stringify(['bearer-token']),
      JSON.stringify({ token: 'must-not-copy' }),
    ])
      expect(legacyPreferencesPatch({ 'musefold:account-notices-read': raw }, at)).toEqual({});
  });
  it('maps only supported fields from the actual old persisted shapes', () => {
    expect(
      legacyPreferencesPatch(
        {
          'musefold:app-preferences': persist({
            themeSource: 'dark',
            reducedMotion: 'off',
            density: 'compact',
            defaultProviderId: 'old',
            schemePriorityMode: 'agent_mediated',
            secret: 'do-not-copy',
          }),
          'musefold:v0.3.0:workbench-preferences-v2': JSON.stringify({
            ratioId: '16:9',
            quality: 'high',
            n: 4,
            background: 'opaque',
          }),
          'musefold:v0.3.0:pinned-workbench-sessions': JSON.stringify([
            'session-2',
            'session-1',
            'session-2',
            '',
            8,
          ]),
          'musefold:onboarding': persist({ onboarded: true }),
          access_token: 'do-not-copy',
        },
        at,
      ),
    ).toEqual({
      theme: 'dark',
      reducedMotion: 'off',
      density: 'compact',
      defaultAspectRatio: '16:9',
      defaultQuality: 'high',
      defaultCount: 4,
      pinnedSessionIds: ['session-2', 'session-1'],
      onboardingCompletedAt: at,
    });
  });
  it('reads legacy scalar keys and does not depend on old application modules', () => {
    expect(
      legacyPreferencesPatch(
        {
          'musefold:theme': 'light',
          'musefold:reduced-motion': 'on',
          'musefold:density': 'compact',
          'musefold:onboarded': '1',
        },
        at,
      ),
    ).toEqual({
      theme: 'light',
      reducedMotion: 'on',
      density: 'compact',
      onboardingCompletedAt: at,
    });
  });
  it('prefers the current old envelope over older scalar values including explicit onboarding false', () => {
    expect(
      legacyPreferencesPatch(
        {
          'musefold:app-preferences': persist({
            themeSource: 'system',
            reducedMotion: 'off',
            density: 'comfortable',
          }),
          'musefold:theme': 'dark',
          'musefold:onboarding': persist({ onboarded: false }),
          'musefold:onboarded': '1',
        },
        at,
      ),
    ).toEqual({
      theme: 'system',
      reducedMotion: 'off',
      density: 'comfortable',
      onboardingCompletedAt: null,
    });
  });
  it('falls back per invalid field while preserving independent valid values', () => {
    expect(
      legacyPreferencesPatch(
        {
          'musefold:app-preferences': persist({ themeSource: 'invalid', density: 'compact' }),
          'musefold:theme-source': 'light',
          'musefold:v0.3.0:workbench-preferences-v2': JSON.stringify({
            ratioId: '99:1',
            quality: 'high',
            n: 6,
          }),
        },
        at,
      ),
    ).toEqual({ theme: 'light', density: 'compact', defaultQuality: 'high' });
  });
  it('normalizes compatible old custom ratios with the current contract', () => {
    expect(
      legacyPreferencesPatch(
        {
          'musefold:v0.3.0:workbench-preferences-v2': JSON.stringify({
            ratioId: 'custom:32:18',
            n: 2,
          }),
        },
        at,
      ),
    ).toEqual({ defaultAspectRatio: '16:9', defaultCount: 2 });
  });
  it.each([
    null,
    [],
    {},
    { 'musefold:app-preferences': '{broken' },
    { 'musefold:app-preferences': '{"state":[]}', 'musefold:theme': 1 },
  ])('rejects invalid outer data without inventing old defaults: %j', (raw) => {
    expect(legacyPreferencesPatch(raw, at)).toEqual({});
  });
  it('never reads non-allowlisted values or inherited fields', () => {
    const raw = Object.create({ 'musefold:theme': 'dark' });
    Object.defineProperty(raw, 'apiKey', {
      get: () => {
        throw new Error('must not read');
      },
    });
    expect(legacyPreferencesPatch(raw, at)).toEqual({});
    expect(LEGACY_PREFERENCE_KEYS).not.toContain('apiKey');
  });
  it('fails instead of silently claiming an oversized known key migrated', () => {
    expect(() =>
      legacyPreferencesPatch(
        { 'musefold:app-preferences': 'x'.repeat(LEGACY_PREFERENCE_MAX_BYTES + 1) },
        at,
      ),
    ).toThrow('migration limit');
  });
});
