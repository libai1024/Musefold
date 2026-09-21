import { opaqueIdSchema } from '@musefold/contracts';

/** Same-origin cookie authentication; asset metadata never supplies a remote URL. */
export function schemeAssetContentUrl(assetId: string): string | null {
  const id = opaqueIdSchema.safeParse(assetId);
  if (!id.success || id.data !== assetId) return null;
  return `/api/v1/design-schemes/assets/${encodeURIComponent(id.data)}/content`;
}
