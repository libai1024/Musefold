import { describe, expect, it } from 'vitest';
import {
  designSchemeAgentMaterialsSchema,
  MAX_AGENT_UPLOAD_TOTAL_BYTES,
} from '../design-scheme-agent-materials';
import { startDesignSchemeAgentInputSchema } from '../design-scheme-agent';
const item = {
  sourceAssetId: 'selected',
  asset: {
    id: 'copy',
    origin: 'uploaded',
    role: 'reference',
    license: null,
    mimeType: 'image/png',
    width: 3,
    height: 2,
    byteSize: 80,
    contentHash: 'a'.repeat(64),
    createdAt: '2026-09-09T00:00:00Z',
  },
};
describe('server-authored Agent materials', () => {
  it('requires distinct copy IDs, unique selection, reference origin and a bounded total', () => {
    expect(designSchemeAgentMaterialsSchema.parse({ uploads: [item] }).uploads).toHaveLength(1);
    for (const uploads of [
      [item, item],
      [{ ...item, sourceAssetId: 'copy' }],
      [{ ...item, asset: { ...item.asset, role: 'cover' } }],
      [{ ...item, asset: { ...item.asset, origin: 'cloud-run' } }],
      [{ ...item, asset: { ...item.asset, byteSize: MAX_AGENT_UPLOAD_TOTAL_BYTES + 1 } }],
    ]) {
      expect(designSchemeAgentMaterialsSchema.safeParse({ uploads }).success).toBe(false);
    }
  });
  it('never accepts a client-authored frozen context or storage key on start', () => {
    const request = {
      operation: 'create',
      input: {
        executionId: 'exec',
        brief: 'brief',
        sourceUris: [],
        sourceBindings: [],
        sourceAssetIds: ['selected'],
      },
    };
    expect(startDesignSchemeAgentInputSchema.safeParse(request).success).toBe(true);
    expect(
      startDesignSchemeAgentInputSchema.safeParse({ ...request, materials: { uploads: [item] } })
        .success,
    ).toBe(false);
    expect(
      designSchemeAgentMaterialsSchema.safeParse({ uploads: [{ ...item, objectKey: 'private' }] })
        .success,
    ).toBe(false);
  });
});
