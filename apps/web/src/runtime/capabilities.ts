import {
  createCapabilityManifest,
  legacyCapabilitiesFromManifest,
  type CapabilityRuntimeContext,
} from '@musefold/domain';

export interface WebCapabilityRuntimeContext extends CapabilityRuntimeContext {
  signedIn: boolean;
  online: boolean;
}

export function createWebCapabilityManifest(context: WebCapabilityRuntimeContext) {
  return createCapabilityManifest({ surface: 'web', ...context });
}

/** Current production rollout, before an account session has been established. */
export const signedOutWebCapabilityManifest = createWebCapabilityManifest({
  signedIn: false,
  online: true,
});

/** Legacy boolean projection for callers not yet migrated to CapabilityManifest. */
export function webCapabilitiesFromManifest(
  manifest: ReturnType<typeof createWebCapabilityManifest>,
) {
  return legacyCapabilitiesFromManifest(manifest);
}
