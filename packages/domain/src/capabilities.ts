export type MusefoldSurface = 'desktop' | 'web';

/** Product outcomes shared by every Musefold host. */
export interface ProductFeatures {
  generation: boolean;
  workbench: boolean;
  generationHistory: boolean;
  promptLibrary: boolean;
  mcpConnections: boolean;
  agent: boolean;
  officialSkills: boolean;
  designSchemes: boolean;
  modelSelection: boolean;
  referenceImages: boolean;
}

export type ProductFeature = keyof ProductFeatures;

/** Runtime capabilities that are intentionally specific to a host. */
export interface HostFeatures {
  host: MusefoldSurface;
  cloudApi: boolean;
  localPersistence: boolean;
  secureCredentialStorage: boolean;
  nativeFileAccess: boolean;
  cloudSyncControl: boolean;
  byokProviders: boolean;
  localAutomation: boolean;
  localMcp: boolean;
  nativeBackup: boolean;
  appUpdates: boolean;
  windowControls: boolean;
  githubSkills: boolean;
  browserShare: boolean;
}

export type HostFeature = Exclude<keyof HostFeatures, 'host'>;
export type CapabilityId = ProductFeature | HostFeature;

export type CapabilityAvailabilityStatus =
  | 'available'
  | 'signed_out'
  | 'offline'
  | 'unsupported'
  | 'disabled'
  | 'rollout';

export type CapabilityFallbackAction = 'sign_in' | 'retry' | 'open_settings' | 'use_other_host';

export type CapabilityAvailability =
  | {
      available: true;
      status: 'available';
      reason: null;
      fallbackAction: null;
    }
  | {
      available: false;
      status: Exclude<CapabilityAvailabilityStatus, 'available'>;
      reason: string;
      fallbackAction: CapabilityFallbackAction;
    };

export interface CapabilityManifest {
  productFeatures: Readonly<ProductFeatures>;
  hostFeatures: Readonly<HostFeatures>;
  availability: Readonly<Record<CapabilityId, CapabilityAvailability>>;
}

export interface CapabilityRuntimeContext {
  signedIn?: boolean;
  online?: boolean;
  /** False means the product feature is outside the active rollout. */
  rollout?: Partial<Readonly<Record<ProductFeature, boolean>>>;
  disabledFeatures?: readonly CapabilityId[];
  unsupportedFeatures?: readonly CapabilityId[];
}

export interface CreateCapabilityManifestInput extends CapabilityRuntimeContext {
  surface: MusefoldSurface;
}

/** Legacy entry-gate shape retained while hosts migrate to CapabilityManifest. */
export interface ProductCapabilities {
  generation: boolean;
  workbench: boolean;
  generationHistory: boolean;
  cloudPrompts: boolean;
  promptSync: boolean;
  cloudMcpConnections: boolean;
  localPrompts: boolean;
  agent: boolean;
  designSchemes: boolean;
  automation: boolean;
  byokProviders: boolean;
  referenceImages: boolean;
}

export type CapabilitySource = Readonly<ProductCapabilities> | CapabilityManifest;

const PRODUCT_FEATURES: Readonly<ProductFeatures> = Object.freeze({
  generation: true,
  workbench: true,
  generationHistory: true,
  promptLibrary: true,
  mcpConnections: true,
  agent: true,
  officialSkills: true,
  designSchemes: true,
  modelSelection: true,
  referenceImages: true,
});

const HOST_FEATURES: Readonly<Record<MusefoldSurface, Readonly<HostFeatures>>> = Object.freeze({
  desktop: Object.freeze({
    host: 'desktop',
    cloudApi: true,
    localPersistence: true,
    secureCredentialStorage: true,
    nativeFileAccess: true,
    cloudSyncControl: true,
    byokProviders: true,
    localAutomation: true,
    localMcp: true,
    nativeBackup: true,
    appUpdates: true,
    windowControls: true,
    githubSkills: true,
    browserShare: false,
  }),
  web: Object.freeze({
    host: 'web',
    cloudApi: true,
    localPersistence: false,
    secureCredentialStorage: false,
    nativeFileAccess: false,
    cloudSyncControl: false,
    byokProviders: false,
    localAutomation: false,
    localMcp: false,
    nativeBackup: false,
    appUpdates: false,
    windowControls: false,
    githubSkills: false,
    browserShare: true,
  }),
});

const PRODUCT_FEATURE_KEYS = Object.freeze(Object.keys(PRODUCT_FEATURES) as ProductFeature[]);
const HOST_FEATURE_KEYS = Object.freeze(
  Object.keys(HOST_FEATURES.desktop).filter((key) => key !== 'host') as HostFeature[],
);
const CAPABILITY_IDS = Object.freeze([...PRODUCT_FEATURE_KEYS, ...HOST_FEATURE_KEYS]);

const CURRENT_WEB_ROLLOUT = new Set<ProductFeature>([
  'generation',
  'workbench',
  'generationHistory',
  'promptLibrary',
  'mcpConnections',
]);

const DESKTOP_SIGN_IN_REQUIRED = new Set<CapabilityId>(['mcpConnections', 'cloudSyncControl']);
const DESKTOP_ONLINE_REQUIRED = new Set<CapabilityId>(['mcpConnections', 'cloudSyncControl']);

const UNAVAILABLE_DETAILS: Readonly<
  Record<
    Exclude<CapabilityAvailabilityStatus, 'available'>,
    { reason: string; fallbackAction: CapabilityFallbackAction }
  >
> = Object.freeze({
  signed_out: {
    reason: 'Sign in to use this feature.',
    fallbackAction: 'sign_in',
  },
  offline: {
    reason: 'Connect to the internet to use this feature.',
    fallbackAction: 'retry',
  },
  unsupported: {
    reason: 'This host does not support this feature.',
    fallbackAction: 'use_other_host',
  },
  disabled: {
    reason: 'This feature is disabled.',
    fallbackAction: 'open_settings',
  },
  rollout: {
    reason: 'This feature is not available in the current rollout.',
    fallbackAction: 'use_other_host',
  },
});

function unavailable(
  status: Exclude<CapabilityAvailabilityStatus, 'available'>,
): CapabilityAvailability {
  return Object.freeze({ available: false, status, ...UNAVAILABLE_DETAILS[status] });
}

function isProductFeature(id: CapabilityId): id is ProductFeature {
  return PRODUCT_FEATURE_KEYS.includes(id as ProductFeature);
}

function capabilityRequiresSignIn(surface: MusefoldSurface, id: CapabilityId): boolean {
  return surface === 'web' ? isProductFeature(id) : DESKTOP_SIGN_IN_REQUIRED.has(id);
}

function capabilityRequiresOnline(surface: MusefoldSurface, id: CapabilityId): boolean {
  return surface === 'web' ? isProductFeature(id) : DESKTOP_ONLINE_REQUIRED.has(id);
}

function productFeatureIsInRollout(
  surface: MusefoldSurface,
  feature: ProductFeature,
  rollout: CapabilityRuntimeContext['rollout'],
): boolean {
  const override = rollout?.[feature];
  if (override !== undefined) return override;
  return surface === 'desktop' || CURRENT_WEB_ROLLOUT.has(feature);
}

function supportedByHost(surface: MusefoldSurface, id: CapabilityId): boolean {
  if (isProductFeature(id)) return PRODUCT_FEATURES[id];
  return HOST_FEATURES[surface][id];
}

/** Builds the manifest without reading host globals or performing IO. */
export function createCapabilityManifest(input: CreateCapabilityManifestInput): CapabilityManifest {
  const signedIn = input.signedIn ?? true;
  const online = input.online ?? true;
  const disabled = new Set(input.disabledFeatures ?? []);
  const unsupported = new Set(input.unsupportedFeatures ?? []);
  const availability = {} as Record<CapabilityId, CapabilityAvailability>;

  for (const id of CAPABILITY_IDS) {
    let state: CapabilityAvailability;
    if (disabled.has(id)) {
      state = unavailable('disabled');
    } else if (!supportedByHost(input.surface, id) || unsupported.has(id)) {
      state = unavailable('unsupported');
    } else if (
      isProductFeature(id) &&
      !productFeatureIsInRollout(input.surface, id, input.rollout)
    ) {
      state = unavailable('rollout');
    } else if (!signedIn && capabilityRequiresSignIn(input.surface, id)) {
      state = unavailable('signed_out');
    } else if (!online && capabilityRequiresOnline(input.surface, id)) {
      state = unavailable('offline');
    } else {
      state = Object.freeze({
        available: true,
        status: 'available',
        reason: null,
        fallbackAction: null,
      });
    }
    availability[id] = state;
  }

  return Object.freeze({
    productFeatures: PRODUCT_FEATURES,
    hostFeatures: HOST_FEATURES[input.surface],
    availability: Object.freeze(availability),
  });
}

export function isProductFeatureAvailable(
  manifest: CapabilityManifest,
  feature: ProductFeature,
): boolean {
  return manifest.productFeatures[feature] && manifest.availability[feature].available;
}

export function isHostFeatureAvailable(
  manifest: CapabilityManifest,
  feature: HostFeature,
): boolean {
  return manifest.hostFeatures[feature] && manifest.availability[feature].available;
}

export function availableProductFeatures(manifest: CapabilityManifest): ProductFeature[] {
  return PRODUCT_FEATURE_KEYS.filter((feature) => isProductFeatureAvailable(manifest, feature));
}

export function isCapabilityManifest(source: CapabilitySource): source is CapabilityManifest {
  return 'availability' in source && 'hostFeatures' in source;
}

/** Projects v2 state into the existing boolean table used by entry gates. */
export function legacyCapabilitiesFromManifest(
  manifest: CapabilityManifest,
): Readonly<ProductCapabilities> {
  const product = (feature: ProductFeature) => isProductFeatureAvailable(manifest, feature);
  const host = (feature: HostFeature) => isHostFeatureAvailable(manifest, feature);
  const desktop = manifest.hostFeatures.host === 'desktop';
  return Object.freeze({
    generation: product('generation'),
    workbench: product('workbench'),
    generationHistory: product('generationHistory'),
    cloudPrompts: !desktop && product('promptLibrary'),
    promptSync: host('cloudSyncControl'),
    cloudMcpConnections: product('mcpConnections'),
    localPrompts: desktop && product('promptLibrary'),
    agent: product('agent'),
    designSchemes: product('designSchemes'),
    automation: host('localAutomation'),
    byokProviders: host('byokProviders'),
    referenceImages: product('referenceImages'),
  });
}

const MANIFESTS: Readonly<Record<MusefoldSurface, CapabilityManifest>> = Object.freeze({
  desktop: createCapabilityManifest({ surface: 'desktop' }),
  web: createCapabilityManifest({ surface: 'web' }),
});

const CAPABILITIES: Readonly<Record<MusefoldSurface, Readonly<ProductCapabilities>>> =
  Object.freeze({
    desktop: legacyCapabilitiesFromManifest(MANIFESTS.desktop),
    web: legacyCapabilitiesFromManifest(MANIFESTS.web),
  });

export function getCapabilityManifest(surface: MusefoldSurface): CapabilityManifest {
  return MANIFESTS[surface];
}

export function getProductCapabilities(surface: MusefoldSurface): Readonly<ProductCapabilities> {
  return CAPABILITIES[surface];
}
