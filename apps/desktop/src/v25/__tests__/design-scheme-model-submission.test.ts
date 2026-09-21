import type { ExecutionBinding } from '@musefold/contracts';
import type { SchemeRunSubmission } from '@musefold/features/design-schemes';
import { describe, expect, it } from 'vitest';
import { toDesktopPrepareRunInput } from '../design-scheme-actions';

function submission(): SchemeRunSubmission {
  return {
    kind: 'run',
    executionId: 'execution-1',
    workbenchSessionId: 'session-1',
    attachment: {
      schemeId: 'scheme-1',
      revisionId: 'revision-1',
      expectedVersion: 3,
      name: '海报',
      summary: '',
      mode: 'trial',
      fidelity: 'faithful',
      sourceLabel: 'Musefold 创建',
      inputs: [],
      coverAssetId: null,
      hasSuccessfulTrial: false,
    },
    brief: '保持输入',
    inputValues: { subject: '书展' },
    referenceImages: ['ref-b', 'ref-a', 'ref-b'].map((id) => ({
      id,
      url: `https://example.test/${id}`,
      name: 'ref.png',
      mimeType: 'image/png',
      byteSize: 32,
    })),
    promptReferenceSelections: [{ promptId: 'prompt-1', scope: 'full', expectedVersion: 2 }],
    providerId: 'account-cloud-row',
    params: { quality: 'high', count: 2 },
  };
}

describe('desktop scheme account model submission', () => {
  it.each(['trial', 'formal'] as const)(
    'passes the selected model and expectation in %s without mutating the connection',
    (mode) => {
      const input = submission();
      input.attachment.mode = mode;
      input.model = 'gpt-image-2';
      input.expectedBinding = {
        apiIssuer: 'https://api.test',
        principalId: 'principal-a',
        payer: { issuer: 'https://upstream.test', ownerId: 'owner-a' },
        credential: { ref: 'credential-a', version: 2 },
        providerId: 'cloud-default',
        model: input.model,
        capabilities: { image: true, text: false },
      } satisfies ExecutionBinding;
      const prepared = toDesktopPrepareRunInput(input);
      expect(prepared.mode).toBe(mode);
      expect(prepared.revisionId).toBe('revision-1');
      expect(prepared.executionSettings).toMatchObject({
        providerId: 'account-cloud-row',
        model: 'gpt-image-2',
        expectedBinding: input.expectedBinding,
        referenceAssetIds: ['ref-b', 'ref-a'],
        promptReferenceSelections: input.promptReferenceSelections,
        outputCount: 2,
        workbenchSessionId: 'session-1',
      });
      expect(prepared).not.toHaveProperty('plan');
    },
  );

  it('keeps legacy/self-provided model settings omitted', () => {
    const settings = toDesktopPrepareRunInput(submission()).executionSettings;
    expect(settings).not.toHaveProperty('model');
    expect(settings).not.toHaveProperty('expectedBinding');
  });
});
