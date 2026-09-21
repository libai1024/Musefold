import { describe, expect, it } from 'vitest';
import { designSchemeRepositoryImagesSchema } from '../design-scheme';
import {
  designSchemeAgentMaterialsSchema,
  designSchemeRepositoryMaterialSchema,
} from '../design-scheme-agent-materials';
const provenance = {
  snapshotId: 'snapshot',
  sourceContentHash: 'a'.repeat(64),
  relativePath: 'images/style.png',
  imageRole: 'style-reference',
  assetId: 'copy',
  contentHash: 'b'.repeat(64),
};
const asset = {
  id: 'copy',
  origin: 'repository',
  role: 'reference',
  license: null,
  mimeType: 'image/png',
  width: 2,
  height: 3,
  byteSize: 100,
  contentHash: 'b'.repeat(64),
  createdAt: '2026-09-09T00:00:00Z',
};
const adoption = {
  snapshotId: 'snapshot',
  sourceContentHash: 'a'.repeat(64),
  reportHash: 'c'.repeat(64),
  images: [{ provenance, asset }],
  omittedPaths: ['unused.png'],
};
describe('repository image adoption contract', () => {
  it('retains legacy material contexts, distinguishes suggested image role from storage role, and bounds provenance', () => {
    expect(designSchemeAgentMaterialsSchema.parse({ uploads: [] })).toEqual({ uploads: [] });
    expect(
      designSchemeAgentMaterialsSchema.safeParse({ uploads: [], repositories: [adoption] }).success,
    ).toBe(true);
    for (const raw of [
      { ...adoption, images: [{ provenance: { ...provenance, snapshotId: 'other' }, asset }] },
      { ...adoption, images: [{ provenance, asset: { ...asset, role: 'style-reference' } }] },
      { ...adoption, images: [{ provenance, asset: { ...asset, origin: 'uploaded' } }] },
      {
        ...adoption,
        images: [{ provenance, asset: { ...asset, license: 'model-claimed-license' } }],
      },
      { ...adoption, omittedPaths: [provenance.relativePath] },
    ])
      expect(designSchemeRepositoryMaterialSchema.safeParse(raw).success).toBe(false);
    expect(designSchemeRepositoryImagesSchema.safeParse([provenance, provenance]).success).toBe(
      false,
    );
    expect(
      designSchemeRepositoryImagesSchema.safeParse([
        { ...provenance, relativePath: '../private.png' },
      ]).success,
    ).toBe(false);
  });
  it('applies the combined byte and image ceilings to repository images as well as uploads', () => {
    const large = {
      ...adoption,
      images: [{ provenance, asset: { ...asset, byteSize: 128 * 1024 * 1024 + 1 } }],
    };
    expect(
      designSchemeAgentMaterialsSchema.safeParse({ uploads: [], repositories: [large] }).success,
    ).toBe(false);
    expect(
      designSchemeAgentMaterialsSchema.safeParse({
        uploads: [],
        repositories: [adoption, adoption],
      }).success,
    ).toBe(false);
  });
});
