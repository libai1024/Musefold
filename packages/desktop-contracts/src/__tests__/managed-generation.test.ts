import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  managedGenerationInputSchema,
  managedGenerationRecordSchema,
  managedGenerationRetrySchema,
  managedReferenceImageSchema,
  managedRunChildInputSchema,
  managedRunChildSchema,
  managedRunRecordSchema,
  managedRunRegistrationSchema,
  registerManagedRunSchema,
} from '../managed-generation';

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const reference = (overrides: Record<string, unknown> = {}) => ({
  id: 'ref-0000000000000001',
  url: '/api/v1/reference-images/ref-0000000000000001/url',
  name: 'ref.png',
  mimeType: 'image/png',
  byteSize: 8,
  digest: digest(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])),
  ...overrides,
});

describe('managed G transport snapshot', () => {
  it('preserves an explicit model without adding one to old snapshots', () => {
    expect(
      managedGenerationInputSchema.parse({ prompt: 'fixture', model: 'gpt-image-2' }).model,
    ).toBe('gpt-image-2');
    expect(managedGenerationInputSchema.parse({ prompt: 'fixture' })).not.toHaveProperty('model');
  });
  it('reads older ordinary records without a retry field and keeps new parent metadata strict', () => {
    expect(managedGenerationRecordSchema.shape.retryOf.parse(undefined)).toBeNull();
    expect(
      managedGenerationRetrySchema.parse({ requestId: 'local-parent', remoteRunId: null }),
    ).toEqual({ requestId: 'local-parent', remoteRunId: null });
    expect(
      managedGenerationRetrySchema.parse({ requestId: 'local-parent', remoteRunId: 'cloud-parent' })
        .remoteRunId,
    ).toBe('cloud-parent');
    for (const invalid of [
      { requestId: '', remoteRunId: null },
      { requestId: 'parent' },
      { requestId: 'parent', remoteRunId: null, token: 'private' },
    ]) {
      expect(managedGenerationRetrySchema.safeParse(invalid).success).toBe(false);
    }
  });
  it('shares the cloud input defaults and canonical ratio without compiling prompt text', () => {
    expect(
      managedGenerationInputSchema.parse({ prompt: ' raw prompt ', aspectRatio: '2:2', count: 4 }),
    ).toMatchObject({
      prompt: 'raw prompt',
      aspectRatio: '1:1',
      count: 4,
      providerId: 'cloud-default',
      size: 'auto',
      referenceImages: [],
    });
  });
  it.each([
    { token: 'fixture' },
    { headers: {} },
    { background: 'transparent' },
    { model: 'two models' },
    { sessionId: 'local' },
    { promptId: 'local' },
    { parentRunId: 'local' },
    { referenceImages: [{ id: 'local' }] },
    { promptReferenceSelections: [{ promptId: 'local' }] },
    { providerId: 'byok' },
    { runKind: 'retry' },
    { count: 3 },
    { size: '2048x2048' },
    { prompt: '' },
  ])('rejects unsupported or secret fields instead of silently dropping them: %j', (fields) => {
    expect(managedGenerationInputSchema.safeParse({ prompt: 'fixture', ...fields }).success).toBe(
      false,
    );
  });
  it('freezes cloud reference ids with a sha256 byte digest of the uploaded bytes', () => {
    expect(managedReferenceImageSchema.parse(reference())).toEqual(reference());
    const parsed = managedGenerationInputSchema.parse({
      prompt: '参考图生成',
      referenceImages: [reference(), reference({ id: 'ref-0000000000000002' })],
    });
    expect(parsed.referenceImages).toHaveLength(2);
    expect(parsed.referenceImages[0]?.digest).toBe(reference().digest);
    // 老记录(无参考图)仍按原样解析:向后兼容,无引用行为不变。
    expect(managedGenerationInputSchema.parse({ prompt: '纯文本' }).referenceImages).toEqual([]);
  });
  it.each([
    ['missing digest', reference({ digest: undefined })],
    ['uppercase digest', reference({ digest: reference().digest.toUpperCase() })],
    ['short digest', reference({ digest: 'abc123' })],
    ['off-scheme display url', reference({ url: 'ftp://untrusted.example/x' })],
    ['extra secret field', reference({ token: 'private' })],
    ['over the shared reference cap', undefined],
  ])('rejects malformed reference entries: %s', (_name, entry) => {
    const value =
      entry === undefined
        ? { referenceImages: Array.from({ length: 17 }, () => reference()) }
        : { referenceImages: [entry] };
    expect(managedGenerationInputSchema.safeParse({ prompt: 'fixture', ...value }).success).toBe(
      false,
    );
  });
});

describe('managed R/S run vocabulary', () => {
  const binding = {
    apiIssuer: 'https://api.example.invalid',
    principalId: 'fixture-principal',
    payer: { issuer: 'https://payer.example.invalid', ownerId: 'fixture-owner' },
    credential: { ref: 'fixture-credential', version: 1 },
    providerId: 'cloud-default',
    model: 'musefold-image-pro',
    capabilities: { image: true, text: false },
  };
  const byokText = {
    providerId: 'text-connection',
    providerType: 'openai-compatible-text',
    model: 'fixture-text',
    baseUrl: 'https://text.example.invalid',
    credentialEpoch: 'text-epoch',
    payerKind: 'external',
    ownerId: null,
    issuer: null,
    policy: 'external',
  };
  const run = {
    runKind: 'run_github_skill' as const,
    originalJobIds: ['job-a', 'job-b'],
    input: { params: { id: 'dsch_fixture' }, body: { n: 2 } },
    frozenRun: { body: { n: 2 }, jobIds: ['job-a', 'job-b'] },
    textBinding: byokText,
  };
  it('keeps the per-child snapshot count-1 and reuses the managed reference vocabulary', () => {
    const child = managedRunChildInputSchema.parse({
      prompt: ' per-image prompt ',
      size: '1024x1024',
      quality: 'auto',
      count: 1,
      referenceImages: [reference()],
    });
    expect(child).toMatchObject({
      prompt: 'per-image prompt',
      count: 1,
      providerId: 'cloud-default',
    });
    for (const invalid of [
      { count: 2 },
      { count: 3 },
      { promptId: 'library-prompt' },
      { runKind: 'refinement' },
      { referenceImages: [{ id: 'local-only' }] },
    ]) {
      expect(managedRunChildInputSchema.safeParse({ prompt: 'x', ...invalid }).success).toBe(false);
    }
  });
  it('registers a run with frozen job ids and a ride-along BYOK text binding, strictly', () => {
    const command = registerManagedRunSchema.parse({
      callerKey: 'fixture-run-key',
      caller: 'local-automation',
      executionId: 'ext_fixture',
      binding,
      run,
      authEpoch: '11111111-1111-4111-8111-111111111111',
      estimatedPoints: null,
      consent: 'interactive',
      now: 1,
    });
    expect(command.run.originalJobIds).toHaveLength(2);
    expect(command.run.textBinding?.payerKind).toBe('external');
    expect(managedRunRegistrationSchema.shape.textBinding.parse(null)).toBeNull();
    for (const invalid of [
      { originalJobIds: [] },
      { originalJobIds: ['job-a', 'job-a'] },
      { originalJobIds: ['job-a', 'job-b', 'job-c', 'job-d', 'job-e'] },
      { runKind: 'generate_image' },
      { input: { bad: () => 1 } },
      { textBinding: { ...byokText, payerKind: 'account', ownerId: 'o' } },
    ]) {
      expect(
        managedRunRegistrationSchema.safeParse({ ...run, ...invalid }).success,
        JSON.stringify(invalid),
      ).toBe(false);
    }
    for (const invalid of [
      { callerKey: '' },
      { binding: { ...binding, providerId: 'byok' } },
      { estimatedPoints: -1 },
      { consent: 'implicit' },
      { run: { ...run, extra: true } },
    ]) {
      expect(
        registerManagedRunSchema.safeParse({
          callerKey: 'k',
          caller: 'c',
          executionId: 'e',
          binding,
          run,
          authEpoch: '11111111-1111-4111-8111-111111111111',
          estimatedPoints: null,
          now: 1,
          ...invalid,
        }).success,
        JSON.stringify(invalid),
      ).toBe(false);
    }
  });
  it('maps each original job to one child with strict defaults and rejection surfaces', () => {
    const child = managedRunChildSchema.parse({
      ordinal: 0,
      originalJobId: 'job-a',
      remoteKey: 'desktop-rs-v1:fixture-child-key',
      submissionState: 'unclaimed',
    });
    expect(child).toMatchObject({
      callId: null,
      localGenerationId: null,
      submissionState: 'unclaimed',
      receipt: null,
      cancelAcknowledgedAt: null,
    });
    for (const invalid of [
      { ordinal: 4 },
      { ordinal: -1 },
      { originalJobId: '' },
      { remoteKey: 'short' },
      { submissionState: 'claimable' },
      { callId: 'call', submissionState: 'unclaimed', receipt: { id: 'r' } },
      { token: 'secret' },
    ]) {
      expect(
        managedRunChildSchema.safeParse({
          ordinal: 1,
          originalJobId: 'job-b',
          remoteKey: 'desktop-rs-v1:fixture-child-key',
          ...invalid,
        }).success,
        JSON.stringify(invalid),
      ).toBe(false);
    }
  });
  it('keeps the run record run-level: no per-run send claim, children carry the mapping', () => {
    const record = managedRunRecordSchema.parse({
      requestId: 'req-fixture',
      callerKey: 'fixture-run-key',
      namespace: '11111111-2222-4111-8111-111111111111',
      binding,
      authEpoch: '11111111-1111-4111-8111-111111111111',
      runtimeEpoch: '11111111-3333-4111-8111-111111111111',
      run,
      children: [
        managedRunChildSchema.parse({
          ordinal: 0,
          originalJobId: 'job-a',
          remoteKey: 'desktop-rs-v1:fixture-child-a',
          submissionState: 'unclaimed',
        }),
        managedRunChildSchema.parse({
          ordinal: 1,
          originalJobId: 'job-b',
          remoteKey: 'desktop-rs-v1:fixture-child-b',
          submissionState: 'unclaimed',
        }),
      ],
      inputHash: digest(new Uint8Array([1])),
      cancelRequestedAt: null,
      createdAt: 1,
      updatedAt: 1,
    });
    expect(record.children.map((child) => child.originalJobId)).toEqual(['job-a', 'job-b']);
    expect(
      managedRunRecordSchema.parse({ ...record, cancelRequestedAt: undefined }).cancelRequestedAt,
    ).toBeNull();
    expect(
      managedRunRecordSchema.safeParse({
        ...record,
        children: [...record.children.slice(1), record.children[0]],
      }).success,
      'child order must follow the frozen plan',
    ).toBe(false);
    for (const invalid of [
      { children: [] },
      {
        children: [
          managedRunChildSchema.parse({
            ordinal: 0,
            originalJobId: 'job-a',
            remoteKey: 'desktop-rs-v1:fixture-child-a',
            submissionState: 'unclaimed',
          }),
        ],
      },
      { runtimeEpoch: 'not-a-uuid' },
      { callId: 'call' },
      { frozenRequest: { prompt: 'x' } },
    ]) {
      expect(
        managedRunRecordSchema.safeParse({ ...record, ...invalid }).success,
        JSON.stringify(invalid),
      ).toBe(false);
    }
  });
});
