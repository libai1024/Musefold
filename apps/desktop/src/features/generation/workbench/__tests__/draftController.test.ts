import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKBENCH_PARAMS,
  createEmptyWorkbenchDraft,
  workbenchDraftControllerReducer,
  type WorkbenchDraftControllerState,
} from '../draftController';

function state(): WorkbenchDraftControllerState {
  return {
    ...createEmptyWorkbenchDraft(),
    params: { ...DEFAULT_WORKBENCH_PARAMS },
    lastError: null,
  };
}

describe('workbench draft controller', () => {
  it('normalizes references and rejects duplicate snapshots', () => {
    const initial = state();
    const reference = {
      promptId: 'p1',
      title: '  ',
      text: '  soft light  ',
      scope: 'full' as const,
    };
    const added = {
      ...initial,
      ...workbenchDraftControllerReducer(initial, {
        type: 'add-reference',
        value: reference,
      }),
    };

    expect(added.draftReferences).toEqual([
      {
        promptId: 'p1',
        title: '未命名提示词',
        text: 'soft light',
        scope: 'full',
      },
    ]);
    expect(
      workbenchDraftControllerReducer(added, {
        type: 'add-reference',
        value: reference,
      }),
    ).toMatchObject({ lastError: { code: 'DUPLICATE_REFERENCE' } });
  });

  it('deduplicates image attachments and clears command-owned history source', () => {
    const initial: WorkbenchDraftControllerState = {
      ...state(),
      draftCommand: 'design-plan',
      draftHistorySource: { items: [] },
    };
    const image = { source: 'upload' as const, path: '/tmp/ref.png', name: 'ref.png' };
    const withImages = {
      ...initial,
      ...workbenchDraftControllerReducer(initial, {
        type: 'add-images',
        value: [image, image],
      }),
    };

    expect(withImages.draftImages).toEqual([image]);
    expect(
      workbenchDraftControllerReducer(withImages, {
        type: 'set-command',
        value: null,
      }),
    ).toMatchObject({ draftCommand: null, draftHistorySource: null });
  });
});
