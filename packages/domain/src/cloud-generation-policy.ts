import { providerSnapshotSchema } from '@musefold/contracts';

export const CLOUD_GENERATION_PROVIDER_ID = 'cloud-default' as const;
export const CLOUD_GENERATION_MODEL = 'musefold-image-pro' as const;

/** Compatibility for the deployed catalog whose image aliases only advertise `openai`.
 * This is transport capability, never a local model catalog or a price source.
 * New aliases can advertise New API's explicit image-generation endpoint.
 */
export function supportsCloudImageGeneration(model: string, endpoints: readonly string[]): boolean {
  return (
    endpoints.includes('image-generation') ||
    (endpoints.includes('openai') &&
      ['musefold-image-pro', 'musefold-image', 'gpt-image-2'].includes(model))
  );
}

/** Shared server policy; the snapshot contains no account or connection credentials. */
export const cloudGenerationProviderSnapshot = providerSnapshotSchema.parse({
  providerId: CLOUD_GENERATION_PROVIDER_ID,
  providerName: '云端生图',
  model: CLOUD_GENERATION_MODEL,
  providerVersion: null,
  capabilities: { text: false, vision: false, image: true, editing: true, multiImage: true },
});
