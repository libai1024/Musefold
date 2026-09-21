import { describe, expect, it } from 'vitest';
import {
  assetOriginSchema,
  designSchemeRunExecutionSettingsSchema,
  runOutputMetadataSchema,
} from '../design-scheme';
import {
  designSchemeRunEventPageSchema,
  designSchemeRunEventQuerySchema,
} from '../design-scheme-execution';

describe('cloud scheme execution contracts', () => {
  it('keeps legacy choices unchanged and validates an explicit model against its display expectation', () => {
    const legacy = {
      providerId: 'cloud-default',
      size: 'auto',
      quality: 'auto',
      outputCount: 1,
      referenceAssetIds: [],
      promptReferenceSelections: [],
    };
    expect(designSchemeRunExecutionSettingsSchema.parse(legacy)).toEqual(legacy);
    const expectedBinding = {
      apiIssuer: 'https://api.test',
      principalId: 'owner',
      payer: { issuer: 'https://images.test', ownerId: '42' },
      credential: { ref: 'credential', version: 1 },
      providerId: 'cloud-default',
      model: 'gpt-image-2',
      capabilities: { image: true, text: false },
    };
    const input = { ...legacy, model: expectedBinding.model, expectedBinding };
    expect(designSchemeRunExecutionSettingsSchema.parse(input)).toEqual(input);
    for (const model of [undefined, '', 'bad model', 'musefold-image-pro'])
      expect(designSchemeRunExecutionSettingsSchema.safeParse({ ...input, model }).success).toBe(
        false,
      );
    expect(
      designSchemeRunExecutionSettingsSchema.safeParse({ ...input, apiKey: 'not-allowed' }).success,
    ).toBe(false);
  });
  it('preserves existing origins and accepts cloud-run only as an additional execution output origin', () => {
    expect(assetOriginSchema.options).toEqual(['repository', 'local-run', 'uploaded', 'cloud-run']);
    const output = {
      id: 'asset_1',
      origin: 'cloud-run',
      role: 'primary',
      runId: 'run_1',
      mimeType: 'image/png',
      width: 3,
      height: 2,
      byteSize: 80,
      contentHash: 'a'.repeat(64),
      createdAt: '2026-09-07T00:00:00.000Z',
      license: null,
    };
    expect(runOutputMetadataSchema.parse(output).origin).toBe('cloud-run');
    expect(runOutputMetadataSchema.parse({ ...output, origin: 'local-run' }).origin).toBe(
      'local-run',
    );
    for (const origin of ['repository', 'uploaded'])
      expect(runOutputMetadataSchema.safeParse({ ...output, origin }).success).toBe(false);
  });
  it('parses bounded canonical event pages and rejects credentials or unknown event payload fields', () => {
    const event = { kind: 'cancelled', executionId: 'execution_1', runId: 'run_1' };
    expect(designSchemeRunEventQuerySchema.parse({})).toEqual({ afterSeq: 0 });
    expect(designSchemeRunEventQuerySchema.parse({ afterSeq: '5' })).toEqual({ afterSeq: 5 });
    expect(designSchemeRunEventQuerySchema.safeParse({ afterSeq: -1 }).success).toBe(false);
    expect(
      designSchemeRunEventPageSchema.parse({ events: [{ seq: 5, event }], nextSeq: 5 }).events,
    ).toHaveLength(1);
    expect(
      designSchemeRunEventPageSchema.safeParse({
        events: [{ seq: 5, event: { ...event, apiKey: 'secret' } }],
        nextSeq: 5,
      }).success,
    ).toBe(false);
    expect(
      designSchemeRunEventPageSchema.safeParse({
        events: Array.from({ length: 101 }, (_, index) => ({ seq: index + 1, event })),
        nextSeq: 101,
      }).success,
    ).toBe(false);
  });
});
