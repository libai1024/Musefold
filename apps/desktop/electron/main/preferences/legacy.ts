import { appPreferencesPatchSchema, type AppPreferencesPatch } from '@musefold/contracts';

// Only non-secret preferences supported by v2.5. Do not enumerate localStorage.
export const LEGACY_PREFERENCE_KEYS = [
  'musefold:app-preferences',
  'musefold:theme-source',
  'musefold:theme',
  'musefold:reduced-motion',
  'musefold:density',
  'musefold:onboarding',
  'musefold:onboarded',
  'musefold:v0.3.0:workbench-preferences-v2',
  'musefold:v0.3.0:pinned-workbench-sessions',
  'musefold:account-notices-read',
] as const;
export const LEGACY_PREFERENCE_MAX_BYTES = 1024 * 1024;

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function legacyPreferencesPatch(raw: unknown, migratedAt: string): AppPreferencesPatch {
  const values = object(raw) ?? {};
  const string = (key: string) => {
    const value = Object.hasOwn(values, key) ? values[key] : undefined;
    if (typeof value !== 'string') return undefined;
    if (Buffer.byteLength(value, 'utf8') > LEGACY_PREFERENCE_MAX_BYTES) {
      throw new Error('Legacy preferences exceed migration limit');
    }
    return value;
  };
  const json = (key: string): unknown => {
    const value = string(key);
    if (value === undefined) return undefined;
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  };
  const app = object(object(json('musefold:app-preferences'))?.state);
  const onboarded = object(object(json('musefold:onboarding'))?.state)?.onboarded;
  const params = object(json('musefold:v0.3.0:workbench-preferences-v2'));
  const patch: Record<string, unknown> = {};
  const put = (key: keyof AppPreferencesPatch, ...values: unknown[]) => {
    for (const value of values) {
      if (value === undefined) continue;
      const parsed = appPreferencesPatchSchema.safeParse({ [key]: value });
      if (parsed.success) {
        Object.assign(patch, parsed.data);
        break;
      }
    }
  };
  put('theme', app?.themeSource, string('musefold:theme-source'), string('musefold:theme'));
  put('reducedMotion', app?.reducedMotion, string('musefold:reduced-motion'));
  put('density', app?.density, string('musefold:density'));
  put('legacyAccountNoticeReadIds', json('musefold:account-notices-read'));
  const ratio = params?.ratioId;
  put('defaultAspectRatio', typeof ratio === 'string' ? ratio.replace(/^custom:/, '') : ratio);
  put('defaultQuality', params?.quality);
  // The approved v2.5 count contract is 1/2/4. Unsupported values are not sent.
  put('defaultCount', params?.n);
  const pinned = json('musefold:v0.3.0:pinned-workbench-sessions');
  if (Array.isArray(pinned)) {
    put('pinnedSessionIds', [
      ...new Set(pinned.filter((id) => typeof id === 'string' && id.length > 0)),
    ]);
  }
  if (onboarded === true || (onboarded === undefined && string('musefold:onboarded') === '1')) {
    put('onboardingCompletedAt', migratedAt);
  } else if (onboarded === false) {
    put('onboardingCompletedAt', null);
  }
  return appPreferencesPatchSchema.parse(patch);
}
