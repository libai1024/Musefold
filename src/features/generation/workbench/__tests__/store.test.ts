import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  retry: vi.fn(),
  cancel: vi.fn(),
  sessionEnsure: vi.fn(),
  sessionList: vi.fn(),
  sessionGet: vi.fn(),
  sessionRename: vi.fn(),
  sessionArchive: vi.fn(),
  sessionDelete: vi.fn(),
  historyLoad: vi.fn(),
  appSetView: vi.fn(),
  // 完成生成时的未读判定读取当前视图；默认模拟用户停留在制作工作台。
  appView: { current: 'generate' },
  provider: { id: 'p1', isActive: true, hasKey: true, name: 'Test', model: 'image', type: 'openai-compatible' },
}));

vi.mock('../../../../lib/ipc', () => ({
  default: {
    image: { generate: mocks.generate, retry: mocks.retry, cancel: mocks.cancel },
    workbenchSession: {
      ensure: mocks.sessionEnsure,
      list: mocks.sessionList,
      get: mocks.sessionGet,
      rename: mocks.sessionRename,
      archive: mocks.sessionArchive,
      delete: mocks.sessionDelete,
    },
  },
}));

vi.mock('../../store', () => ({
  useGenerationStore: {
    getState: () => ({ providers: [mocks.provider], activeProviderId: 'p1' }),
  },
}));

vi.mock('../../../../stores/app', () => ({
  useAppStore: {
    getState: () => ({ defaultProviderId: null, setView: mocks.appSetView, currentView: mocks.appView.current }),
  },
}));

// Node 测试环境的 localStorage 不可写，未读标记（sessionPreferences）需要一个可用实现。
const storageValues = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storageValues.get(key) ?? null,
  setItem: (key: string, value: string) => storageValues.set(key, String(value)),
  removeItem: (key: string) => storageValues.delete(key),
  clear: () => storageValues.clear(),
  key: (index: number) => [...storageValues.keys()][index] ?? null,
  get length() { return storageValues.size; },
} as Storage);

vi.mock('../../../history/store', () => ({
  useHistoryStore: { getState: () => ({ load: mocks.historyLoad }) },
}));

import {
  clearSessionTurnsCacheForTests,
  composeRefinementPrompt,
  DEFAULT_WORKBENCH_PARAMS,
  useGenerationWorkbenchStore,
  WORKBENCH_PROMPT_LIMIT,
} from '../store';
import { composePromptWithRatioConstraint } from '../promptConstraints';
import { composePromptWithRefinementImageHint } from '../imageReferences';
import { WORKBENCH_SESSION_RESTART_REQUIRED } from '../sessionErrors';
import { readUnreadSessionIds } from '../sessionPreferences';

function reset(): void {
  mocks.provider.hasKey = true;
  mocks.provider.type = 'openai-compatible';
  mocks.appView.current = 'generate';
  storageValues.clear();
  clearSessionTurnsCacheForTests();
  mocks.sessionEnsure.mockResolvedValue({});
  mocks.sessionList.mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
  useGenerationWorkbenchStore.setState({
    turns: [],
    draftPrompt: '',
    draftNegativePrompt: '',
    draftReferences: [],
    draftImages: [],
    draftSource: { kind: 'manual' },
    params: { ...DEFAULT_WORKBENCH_PARAMS },
    isGenerating: false,
    runningTurns: {},
    activeTurnId: null,
    activeJobId: null,
    cancelRequested: false,
    lastError: null,
    activeSessionId: null,
    sessions: [],
    archivedSessions: [],
    sessionsLoading: false,
    sessionsError: null,
    refinementContext: null,
  });
  vi.clearAllMocks();
  mocks.sessionList.mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
}

describe('session creation timing', () => {
  it('adds a titled running session as soon as send is clicked', async () => {
    let finishGeneration!: (value: { historyId: string; status: 'success'; imagePath: string }) => void;
    mocks.generate.mockReturnValueOnce(new Promise((resolve) => { finishGeneration = resolve; }));
    const state = useGenerationWorkbenchStore.getState();
    state.setDraftPrompt('  一张 极简的 城市海报  ');

    const submission = state.submitDraft();

    expect(useGenerationWorkbenchStore.getState()).toMatchObject({
      isGenerating: true,
      activeSessionId: state.sessionId,
      sessions: [{
        id: state.sessionId,
        title: '一张 极简的 城市海报',
        conversationKind: 'chat',
        latestStatus: 'running',
      }],
    });
    expect(mocks.sessionEnsure).toHaveBeenCalledWith(expect.objectContaining({
      id: state.sessionId,
      title: '一张 极简的 城市海报',
    }));

    finishGeneration({ historyId: 'run-now', status: 'success', imagePath: '/tmp/run-now.png' });
    await submission;
  });
});

beforeEach(reset);

describe('single-surface workbench', () => {
  it('starts free creation with one parameter set and no persisted session', () => {
    const state = useGenerationWorkbenchStore.getState();
    expect(state.params).toEqual(DEFAULT_WORKBENCH_PARAMS);
    expect(state.params.n).toBe(4);
    expect(state.turns).toEqual([]);
    expect(state.activeSessionId).toBeNull();
    expect('mode' in state).toBe(false);
  });

  it('adds, deduplicates and removes reference snapshots without generating', () => {
    const reference = { promptId: 'prompt-1', title: 'Light', text: 'soft light', scope: 'excerpt' as const };
    const state = useGenerationWorkbenchStore.getState();
    state.addDraftReference(reference);
    state.addDraftReference(reference);
    expect(useGenerationWorkbenchStore.getState().draftReferences).toEqual([reference]);
    expect(useGenerationWorkbenchStore.getState().lastError?.code).toBe('DUPLICATE_REFERENCE');
    useGenerationWorkbenchStore.getState().removeDraftReference(0);
    expect(useGenerationWorkbenchStore.getState().draftReferences).toEqual([]);
    expect(mocks.generate).not.toHaveBeenCalled();
  });
});

describe('submitDraft', () => {
  it('sends the composed prompt, reference snapshot and workbench grouping without a mode field', async () => {
    mocks.generate.mockResolvedValue({ historyId: 'history-1', status: 'success', imagePath: '/tmp/one.png' });
    const state = useGenerationWorkbenchStore.getState();
    state.setParams({ n: 1 });
    state.setDraftPrompt('portrait');
    state.addDraftReference({ promptId: 'prompt-1', title: 'Light', text: 'soft side light', scope: 'excerpt' });

    await state.submitDraft();

    const request = mocks.generate.mock.calls[0][0];
    expect(request.prompt).toBe(composePromptWithRatioConstraint(
      'portrait\n\n参考提示词：\n\n【Light｜选中片段】\nsoft side light',
      '1:1',
    ));
    expect(request.promptReferences).toEqual([{ promptId: 'prompt-1', title: 'Light', text: 'soft side light', scope: 'excerpt' }]);
    expect(request.workbench).toMatchObject({ turnIndex: 0, resultIndex: 0, userPrompt: 'portrait' });
    expect(request).not.toHaveProperty('generationMode');
    expect(useGenerationWorkbenchStore.getState().turns[0]).not.toHaveProperty('mode');
  });

  it('allows reference-only submission and blocks final prompts over the shared limit', async () => {
    mocks.generate.mockResolvedValue({ historyId: 'history-ref', status: 'success', imagePath: '/tmp/ref.png' });
    const state = useGenerationWorkbenchStore.getState();
    state.setParams({ n: 1 });
    state.addDraftReference({ promptId: 'p1', title: 'Only', text: 'reference body', scope: 'full' });
    await state.submitDraft();
    expect(mocks.generate).toHaveBeenCalledTimes(1);

    reset();
    useGenerationWorkbenchStore.getState().setDraftPrompt('x'.repeat(WORKBENCH_PROMPT_LIMIT));
    useGenerationWorkbenchStore.getState().addDraftReference({ promptId: 'p2', title: 'Extra', text: 'more', scope: 'full' });
    await useGenerationWorkbenchStore.getState().submitDraft();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(useGenerationWorkbenchStore.getState().lastError?.code).toBe('PROMPT_TOO_LONG');
  });

  it('keeps mixed batch slots stable when one request fails', async () => {
    let call = 0;
    mocks.generate.mockImplementation(async () => {
      call += 1;
      if (call === 2) throw new Error('network');
      return { historyId: `history-${call}`, status: 'success', imagePath: `/tmp/${call}.png` };
    });
    const state = useGenerationWorkbenchStore.getState();
    state.setParams({ n: 4 });
    state.setDraftPrompt('four directions');
    await state.submitDraft();

    const turn = useGenerationWorkbenchStore.getState().turns[0];
    expect(mocks.generate).toHaveBeenCalledTimes(4);
    expect(turn.results).toHaveLength(4);
    expect(turn.results.map((result) => result.status)).toEqual(['success', 'failed', 'success', 'success']);
    expect(turn.status).toBe('partial');
  });

  it('submits Doubao once and expands its four images and reply into one turn', async () => {
    mocks.provider.type = 'doubao-web';
    mocks.generate.mockResolvedValue({
      historyId: 'doubao-one',
      status: 'success',
      imagePath: '/tmp/doubao-1.webp',
      images: [1, 2, 3, 4].map((index) => ({
        assetId: `doubao-one-${index}`,
        imagePath: `/tmp/doubao-${index}.webp`,
        actualSize: { width: 1024, height: 1024 },
      })),
      providerResponse: {
        kind: 'doubao-web',
        message: '已按 1:1 画幅生成 4 张安静的静物摄影方向。',
        expectedImageCount: 4,
        receivedImageCount: 4,
      },
    });
    const state = useGenerationWorkbenchStore.getState();
    state.setParams({ n: 4 });
    state.setDraftPrompt('豆包四图生图');

    await state.submitDraft();

    expect(mocks.generate).toHaveBeenCalledTimes(1);
    const turn = useGenerationWorkbenchStore.getState().turns[0];
    expect(mocks.generate.mock.calls[0][0]).toMatchObject({ n: 1 });
    expect(turn.params.n).toBe(4);
    expect(turn.results).toHaveLength(4);
    expect(turn.results.map((result) => result.imagePath)).toEqual([
      '/tmp/doubao-1.webp',
      '/tmp/doubao-2.webp',
      '/tmp/doubao-3.webp',
      '/tmp/doubao-4.webp',
    ]);
    expect(turn.results.map((result) => result.assetId)).toEqual([
      'doubao-one-1',
      'doubao-one-2',
      'doubao-one-3',
      'doubao-one-4',
    ]);
    expect(turn.providerResponse).toMatchObject({
      kind: 'doubao-web',
      receivedImageCount: 4,
      message: expect.stringContaining('静物摄影'),
    });
  });

  it('passes reference images to Doubao web for image editing', async () => {
    mocks.provider.type = 'doubao-web';
    mocks.generate.mockResolvedValue({
      historyId: 'doubao-edit',
      status: 'success',
      imagePath: '/tmp/doubao-edit.png',
      images: [{ imagePath: '/tmp/doubao-edit.png', actualSize: { width: 1024, height: 1024 } }],
    });
    const state = useGenerationWorkbenchStore.getState();
    state.setDraftPrompt('带参考图的请求');
    state.addDraftImages([{
      source: 'upload',
      path: '/tmp/previews/uploads/reference.png',
      name: 'reference.png',
      mimeType: 'image/png',
    }]);

    await state.submitDraft();

    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(mocks.generate.mock.calls[0][0]).toMatchObject({
      n: 1,
      referenceImages: [{ path: '/tmp/previews/uploads/reference.png', source: 'upload' }],
    });
  });

  it('refines a selected Doubao variant without embedding its original Skill prompt', async () => {
    mocks.provider.type = 'doubao-web';
    mocks.generate.mockResolvedValueOnce({
      historyId: 'doubao-batch',
      status: 'success',
      imagePath: '/tmp/doubao-batch-1.png',
      images: [1, 2, 3, 4].map((index) => ({
        assetId: index === 1 ? 'doubao-batch' : `doubao-batch-${index}`,
        imagePath: `/tmp/doubao-batch-${index}.png`,
      })),
    });
    const state = useGenerationWorkbenchStore.getState();
    state.setDraftPrompt('豆包四图');
    await state.submitDraft();

    const pastedSkill = `# Pasted Skill\n${'很长的规则'.repeat(10_000)}`;
    useGenerationWorkbenchStore.setState((current) => ({
      turns: current.turns.map((turn) => ({
        ...turn,
        prompt: pastedSkill,
        source: {
          kind: 'skill' as const,
          label: 'Pasted Skill',
          repositoryUrl: 'https://github.com/example/pasted-skill',
          compiledPrompt: pastedSkill,
          executionMode: 'direct-forward' as const,
          trace: [],
        },
      })),
    }));
    const parent = useGenerationWorkbenchStore.getState().turns[0];
    const selected = parent.results[2];
    useGenerationWorkbenchStore.getState().startRefinement(parent.id, selected.id);
    expect(useGenerationWorkbenchStore.getState().refinementContext?.images[0]).toMatchObject({
      historyId: 'doubao-batch',
      assetId: 'doubao-batch-3',
      path: '/tmp/doubao-batch-3.png',
    });

    mocks.generate.mockResolvedValueOnce({
      historyId: 'doubao-refined',
      status: 'success',
      imagePath: '/tmp/doubao-refined.png',
    });
    await useGenerationWorkbenchStore.getState().submitRefinement(parent.id, selected.id, '增强晨光');
    const refinementRequest = mocks.generate.mock.calls.at(-1)?.[0];
    expect(refinementRequest).toMatchObject({
      prompt: '增强晨光',
      refinementInstruction: '增强晨光',
      sourceAssetId: 'doubao-batch-3',
      referenceImages: [{
        historyId: 'doubao-batch',
        assetId: 'doubao-batch-3',
        path: '/tmp/doubao-batch-3.png',
      }],
    });
    expect(refinementRequest.prompt).not.toContain('Pasted Skill');
    expect(refinementRequest.skillRuntime).toBeUndefined();
  });

  it('marks the session unread when generation finishes outside the workbench view', async () => {
    mocks.appView.current = 'library';
    mocks.generate.mockResolvedValue({ historyId: 'history-away', status: 'success', imagePath: '/tmp/away.png' });
    const state = useGenerationWorkbenchStore.getState();
    state.setParams({ n: 1 });
    state.setDraftPrompt('后台完成的生成');
    await state.submitDraft();
    expect(readUnreadSessionIds()).toContain(state.sessionId);
  });

  it('keeps the session read when the user watches the workbench during generation', async () => {
    mocks.generate.mockResolvedValue({ historyId: 'history-watch', status: 'success', imagePath: '/tmp/watch.png' });
    const state = useGenerationWorkbenchStore.getState();
    state.setParams({ n: 1 });
    state.setDraftPrompt('看着完成的生成');
    await state.submitDraft();
    expect(readUnreadSessionIds()).not.toContain(state.sessionId);
  });

  it('creates a titled session even when generation is blocked by missing credentials', async () => {
    mocks.provider.hasKey = false;
    const state = useGenerationWorkbenchStore.getState();
    state.setDraftPrompt('blocked');
    await state.submitDraft();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(useGenerationWorkbenchStore.getState().activeSessionId).toBe(state.sessionId);
    expect(useGenerationWorkbenchStore.getState().sessions[0]).toMatchObject({ title: 'blocked' });
  });

  it('passes a staged local image to the provider and clears it after submission', async () => {
    mocks.generate.mockResolvedValue({ historyId: 'image-edit', status: 'success', imagePath: '/tmp/edited.png' });
    const image = {
      source: 'upload' as const,
      path: '/tmp/previews/uploads/reference.png',
      name: 'reference.png',
      mimeType: 'image/png' as const,
      sizeBytes: 128,
    };
    const state = useGenerationWorkbenchStore.getState();
    state.setParams({ n: 1 });
    state.setDraftPrompt('替换背景');
    state.addDraftImages([image]);

    await state.submitDraft();

    expect(mocks.generate.mock.calls[0][0].referenceImages).toEqual([image]);
    expect(useGenerationWorkbenchStore.getState().turns[0].referenceImages).toEqual([image]);
    expect(useGenerationWorkbenchStore.getState().draftImages).toEqual([]);
  });

  it('restores an earlier message and its reference image without automatically submitting', async () => {
    mocks.generate.mockResolvedValue({ historyId: 'image-edit', status: 'success', imagePath: '/tmp/edited.png' });
    const image = {
      source: 'upload' as const,
      path: '/tmp/previews/uploads/reference.png',
      name: 'reference.png',
      mimeType: 'image/png' as const,
      sizeBytes: 128,
    };
    const state = useGenerationWorkbenchStore.getState();
    state.setParams({ n: 1, ratioId: '16:9' });
    state.setDraftPrompt('替换背景');
    state.setDraftNegativePrompt('文字');
    state.addDraftImages([image]);
    await state.submitDraft();
    const turn = useGenerationWorkbenchStore.getState().turns[0];

    useGenerationWorkbenchStore.getState().editTurn(turn.id);

    const restored = useGenerationWorkbenchStore.getState();
    expect(restored.draftPrompt).toBe('替换背景');
    expect(restored.draftNegativePrompt).toBe('文字');
    expect(restored.draftImages).toEqual([image]);
    expect(restored.params.ratioId).toBe('16:9');
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });
});

describe('refinement', () => {
  async function createParent(): Promise<void> {
    mocks.generate.mockResolvedValueOnce({ historyId: 'parent-run', status: 'success', imagePath: '/tmp/parent.png' });
    const state = useGenerationWorkbenchStore.getState();
    state.setParams({ n: 1 });
    state.setDraftPrompt('base prompt');
    await state.submitDraft();
  }

  it('uses the selected image as parent and clears the bottom context after submission', async () => {
    await createParent();
    const parent = useGenerationWorkbenchStore.getState().turns[0];
    useGenerationWorkbenchStore.getState().startRefinement(parent.id, parent.results[0].id);
    expect(useGenerationWorkbenchStore.getState().refinementContext).toMatchObject({ historyId: 'parent-run' });

    mocks.generate.mockResolvedValueOnce({ historyId: 'child-run', status: 'success', imagePath: '/tmp/child.png' });
    await useGenerationWorkbenchStore.getState().submitRefinement(parent.id, parent.results[0].id, '增加留白');
    const request = mocks.generate.mock.calls.at(-1)?.[0];
    expect(request).toMatchObject({
      parentHistoryId: 'parent-run',
      sourceAssetId: 'parent-run',
      refinementInstruction: '增加留白',
      prompt: composePromptWithRefinementImageHint(
        composeRefinementPrompt(
          composePromptWithRatioConstraint('base prompt', '1:1'),
          '增加留白',
        ),
        1,
      ),
      referenceImages: [{
        source: 'history',
        path: '/tmp/parent.png',
        historyId: 'parent-run',
        name: '图 1',
      }],
    });
    expect(useGenerationWorkbenchStore.getState().turns).toHaveLength(2);
    expect(useGenerationWorkbenchStore.getState().refinementContext).toBeNull();
    expect(useGenerationWorkbenchStore.getState().draftPrompt).toBe('');
  });

  it('keeps the target first and appends uploaded images for other uses', async () => {
    await createParent();
    const parent = useGenerationWorkbenchStore.getState().turns[0];
    const replacement = {
      source: 'upload' as const,
      path: '/tmp/previews/uploads/replacement.webp',
      name: 'replacement.webp',
      mimeType: 'image/webp' as const,
      sizeBytes: 256,
    };
    mocks.generate.mockResolvedValueOnce({ historyId: 'child-replaced', status: 'success', imagePath: '/tmp/child.webp' });

    await useGenerationWorkbenchStore.getState().submitRefinement(
      parent.id,
      parent.results[0].id,
      '换成冷色背景',
      [replacement],
    );

    const request = mocks.generate.mock.calls.at(-1)?.[0];
    expect(request.referenceImages).toEqual([
      {
        source: 'history',
        path: '/tmp/parent.png',
        historyId: 'parent-run',
        name: '图 1',
      },
      replacement,
    ]);
    expect(request.prompt).toContain('图 1 为本次微调目标。');
    expect(request.prompt).toContain('图 2 及后续图片仅按用户说明用于参考、风格学习或融合。');
  });

  it('supports chained refinement and rejects an oversized child prompt', async () => {
    await createParent();
    const parent = useGenerationWorkbenchStore.getState().turns[0];
    mocks.generate.mockResolvedValueOnce({ historyId: 'child-run', status: 'success', imagePath: '/tmp/child.png' });
    await useGenerationWorkbenchStore.getState().submitRefinement(parent.id, parent.results[0].id, '调整结构');
    const child = useGenerationWorkbenchStore.getState().turns[1];
    mocks.generate.mockResolvedValueOnce({ historyId: 'grandchild-run', status: 'success', imagePath: '/tmp/grandchild.png' });
    await useGenerationWorkbenchStore.getState().submitRefinement(child.id, child.results[0].id, '减少文字');
    expect(useGenerationWorkbenchStore.getState().turns).toHaveLength(3);

    const calls = mocks.generate.mock.calls.length;
    await useGenerationWorkbenchStore.getState().submitRefinement(
      child.id,
      child.results[0].id,
      'x'.repeat(WORKBENCH_PROMPT_LIMIT),
    );
    expect(mocks.generate).toHaveBeenCalledTimes(calls);
    expect(useGenerationWorkbenchStore.getState().lastError?.code).toBe('PROMPT_TOO_LONG');
  });
});

describe('reuse and session restore', () => {
  it('turns a missing session handler into an actionable restart state', async () => {
    mocks.sessionList.mockRejectedValueOnce(new Error(
      "Error invoking remote method 'workbenchSession:list': Error: No handler registered for 'workbenchSession:list'",
    ));

    await useGenerationWorkbenchStore.getState().loadSessions();

    expect(useGenerationWorkbenchStore.getState().sessionsError)
      .toBe(WORKBENCH_SESSION_RESTART_REQUIRED);
  });

  it('restores the submitted text, references and parameter snapshot for another pass', async () => {
    mocks.generate.mockResolvedValue({ historyId: 'history-reuse', status: 'success', imagePath: '/tmp/reuse.png' });
    const state = useGenerationWorkbenchStore.getState();
    state.setParams({ n: 2, ratioId: '16:9', quality: 'high' });
    state.setDraftPrompt('reuse me');
    state.addDraftReference({ promptId: 'p1', title: 'Ref', text: 'detail', scope: 'full' });
    await state.submitDraft();
    const turn = useGenerationWorkbenchStore.getState().turns[0];
    useGenerationWorkbenchStore.getState().reuseResult(turn.id, turn.results[0].id);

    const next = useGenerationWorkbenchStore.getState();
    expect(next.draftPrompt).toBe('reuse me');
    expect(next.draftReferences).toHaveLength(1);
    expect(next.params).toMatchObject({ n: 2, ratioId: '16:9', quality: 'high' });
    expect(next.draftSource).toMatchObject({ kind: 'history', id: 'history-reuse' });
  });

  it('restores prompt reference snapshots when opening a persisted session', async () => {
    mocks.sessionGet.mockResolvedValue({
      session: {
        id: 'session-1', title: 'Saved',
        createdAt: 100, updatedAt: 200, archivedAt: null, deletedAt: null,
      },
      runs: [{
        run: {
          id: 'run-1', runKind: 'free_generation',
          workbenchSessionId: 'session-1', workbenchTurnId: 'turn-1', turnIndex: 0, resultIndex: 0,
          parentRunId: null, retryOfRunId: null, sourceAssetId: null, providerId: 'p1', model: 'image',
          userPrompt: 'saved prompt', basePrompt: 'saved prompt', refinementInstruction: null,
          finalPrompt: 'saved prompt', negativePrompt: null,
          params: {
            schemaVersion: 1,
            aspectRatio: '1:1',
            quality: 'medium',
            n: 1,
            background: 'auto',
            referenceImages: [{
              path: '/tmp/saved-reference.png',
              source: 'upload',
              name: 'saved-reference.png',
              mimeType: 'image/png',
              sizeBytes: 42,
            }],
            skillRuntime: {
              label: 'Saved Skill',
              repositoryUrl: 'https://github.com/example/saved-skill',
              executionMode: 'agent',
              trace: [
                { id: 'agent', kind: 'tool', title: 'Agent 执行 Skill', status: 'success' },
                { id: 'image-generation', kind: 'tool', title: '调用生图模型', status: 'running' },
              ],
            },
          },
          promptSnapshot: { schemaVersion: 1, userPrompt: 'saved prompt', basePrompt: 'saved prompt', refinementInstruction: null, finalPrompt: 'saved prompt', negativePrompt: null, sourceRanges: [] },
          status: 'success', errorCode: null, errorMessage: null, requestId: 'run-1', estimatedCost: null,
          actualCost: 0.1, durationMs: 1000, createdAt: 100, startedAt: 101, finishedAt: 200, deletedAt: null,
        },
        assets: [0, 1, 2, 3].map((position) => ({
          id: `run-1-${position}`,
          runId: 'run-1',
          position,
          status: 'available',
          mediaPath: `/tmp/saved-${position + 1}.png`,
          mimeType: 'image/png',
          width: 1024,
          height: 1024,
          fileSize: null,
          checksum: null,
          createdAt: 200 + position,
        })),
        providerResponse: {
          kind: 'doubao-web',
          message: '豆包附带的回复文字',
          expectedImageCount: 4,
          receivedImageCount: 4,
        },
        promptReferences: [{ promptId: 'prompt-1', title: 'Snapshot', text: 'frozen excerpt', scope: 'excerpt' }],
      }],
    });

    await useGenerationWorkbenchStore.getState().openSession('session-1');
    const state = useGenerationWorkbenchStore.getState();
    expect(state.activeSessionId).toBe('session-1');
    expect(state.turns[0].references).toEqual([{ promptId: 'prompt-1', title: 'Snapshot', text: 'frozen excerpt', scope: 'excerpt' }]);
    expect(state.turns[0].referenceImages).toEqual([{
      path: '/tmp/saved-reference.png',
      source: 'upload',
      name: 'saved-reference.png',
      mimeType: 'image/png',
      sizeBytes: 42,
    }]);
    expect(state.turns[0].results.map((result) => result.imagePath)).toEqual([
      '/tmp/saved-1.png',
      '/tmp/saved-2.png',
      '/tmp/saved-3.png',
      '/tmp/saved-4.png',
    ]);
    expect(state.turns[0].providerResponse).toMatchObject({
      kind: 'doubao-web',
      message: '豆包附带的回复文字',
      receivedImageCount: 4,
    });
    expect(state.turns[0].source).toMatchObject({
      kind: 'skill',
      label: 'Saved Skill',
      repositoryUrl: 'https://github.com/example/saved-skill',
      trace: expect.arrayContaining([
        expect.objectContaining({ id: 'image-generation', status: 'success', title: '图片生成完成' }),
      ]),
    });
  });
});

// 生成期间允许新建/切换对话：运行中的对话进入后台缓存，事件继续写入，
// 完成结果写回原对话并标未读；未落库的方案创建轮（草稿卡片）切回后依然在场。
describe('background sessions during generation', () => {
  beforeEach(reset);

  const schemeSource = {
    kind: 'scheme' as const,
    schemeId: 's1',
    revisionId: 'r1',
    label: '小黑插画',
    summary: '手绘插画方案',
    mode: 'trial' as const,
    fidelity: 'faithful' as const,
    sourceLabel: 'acme/illust',
    inputs: [],
    coverAssetId: null,
    hasSuccessfulTrial: false,
  };

  it('试运行期间可以开新对话：运行转后台，完成写回原对话、标未读，切回原样恢复', async () => {
    const begin = useGenerationWorkbenchStore.getState().beginSchemeRunTurn({
      userPrompt: '试运行',
      executionId: 'exec-bg',
      providerId: 'p1',
      params: { ...DEFAULT_WORKBENCH_PARAMS, n: 1 },
      referenceImages: [],
      source: schemeSource,
    });
    expect(begin).not.toBeNull();
    const runSessionId = useGenerationWorkbenchStore.getState().sessionId;
    // 同一对话内单飞锁仍然生效（不能再次发起）。
    expect(useGenerationWorkbenchStore.getState().beginSchemeRunTurn({
      userPrompt: 'x',
      executionId: 'exec-2',
      providerId: 'p1',
      params: { ...DEFAULT_WORKBENCH_PARAMS, n: 1 },
      referenceImages: [],
      source: schemeSource,
    })).toBeNull();

    // 运行中开新对话：不再被阻塞，运行对话进入后台。
    useGenerationWorkbenchStore.getState().newSession();
    const fresh = useGenerationWorkbenchStore.getState();
    expect(fresh.sessionId).not.toBe(runSessionId);
    expect(fresh.turns).toEqual([]);
    expect(fresh.isGenerating).toBe(true);

    // 运行事件与完成结果写回后台缓存里的原对话。
    useGenerationWorkbenchStore.getState().upsertSchemeRunTrace(begin!.turnId, {
      id: 'compile-prompt', kind: 'tool', title: '编译方案提示词', status: 'success',
    });
    useGenerationWorkbenchStore.getState().finishSchemeRunTurn(begin!.turnId, {
      compiledPrompt: 'compiled prompt',
      generations: [{
        jobId: begin!.jobIds[0],
        resultIndex: 0,
        result: { historyId: 'h1', status: 'success', imagePath: '/tmp/bg-run.png' },
      }],
      trace: [{ id: 'run-final', kind: 'system', title: '试运行成功，结果已加入草稿相册', status: 'success' }],
    });
    expect(useGenerationWorkbenchStore.getState().isGenerating).toBe(false);
    // 用户不在原对话：即使停留在制作视图也要标未读。
    expect(readUnreadSessionIds()).toContain(runSessionId);

    // 切回原对话：从内存缓存恢复（不查数据库），结果与轨迹在场。
    await useGenerationWorkbenchStore.getState().openSession(runSessionId);
    const restored = useGenerationWorkbenchStore.getState();
    expect(mocks.sessionGet).not.toHaveBeenCalled();
    expect(restored.sessionId).toBe(runSessionId);
    expect(restored.turns).toHaveLength(1);
    expect(restored.turns[0].results[0]).toMatchObject({ status: 'success', imagePath: '/tmp/bg-run.png' });
    expect(restored.turns[0].source).toMatchObject({ kind: 'scheme-run', state: 'succeeded' });
  });

  it('并行生成：方案运行占用 A 对话时，B 对话可以照常提交生图', async () => {
    // A 对话：方案试运行进行中。
    const begin = useGenerationWorkbenchStore.getState().beginSchemeRunTurn({
      userPrompt: '试运行',
      executionId: 'exec-parallel',
      providerId: 'p1',
      params: { ...DEFAULT_WORKBENCH_PARAMS, n: 1 },
      referenceImages: [],
      source: schemeSource,
    });
    expect(begin).not.toBeNull();
    // 同一对话内不能再次提交（对话粒度单飞锁）。
    await useGenerationWorkbenchStore.getState().submitDraft();
    expect(useGenerationWorkbenchStore.getState().turns).toHaveLength(1);

    // B 对话：提交普通生图，不再被 A 的运行阻塞。
    useGenerationWorkbenchStore.getState().newSession();
    mocks.generate.mockResolvedValueOnce({ historyId: 'h-parallel', status: 'success', imagePath: '/tmp/parallel.png' });
    useGenerationWorkbenchStore.getState().setDraftPrompt('并行生成的海报');
    useGenerationWorkbenchStore.getState().setParams({ n: 1 });
    await useGenerationWorkbenchStore.getState().submitDraft();

    const state = useGenerationWorkbenchStore.getState();
    expect(state.turns).toHaveLength(1);
    expect(state.turns[0].results[0]).toMatchObject({ status: 'success', imagePath: '/tmp/parallel.png' });
    // B 完成后，A 的方案运行仍在登记中（全局仍在生成，但只锁 A 对话）。
    expect(state.isGenerating).toBe(true);
    expect(Object.values(state.runningTurns)).toHaveLength(1);
    expect(Object.keys(state.runningTurns)).toEqual([begin!.turnId]);

    // A 完成后登记清空。
    useGenerationWorkbenchStore.getState().finishSchemeRunTurn(begin!.turnId, {
      compiledPrompt: 'p',
      generations: [{ jobId: begin!.jobIds[0], resultIndex: 0, result: { historyId: 'h1', status: 'success', imagePath: '/tmp/a.png' } }],
      trace: [],
    });
    expect(useGenerationWorkbenchStore.getState().isGenerating).toBe(false);
    expect(useGenerationWorkbenchStore.getState().runningTurns).toEqual({});
  });

  it('未试运行的方案草稿对话切走后保留：切回从内存恢复草稿卡片（数据库无 runs）', async () => {
    const begin = useGenerationWorkbenchStore.getState().beginSchemeCreationTurn({
      brief: '做一个海报方案',
      executionId: 'exec-create',
      label: '创建设计方案',
    });
    expect(begin).not.toBeNull();
    const creationSessionId = useGenerationWorkbenchStore.getState().sessionId;
    useGenerationWorkbenchStore.getState().completeSchemeCreationTurn(begin!.turnId, {
      id: 'dsch_1',
      name: '极简海报',
      summary: '双色印刷',
      status: 'draft',
      sourcePresentation: 'musefold-created',
      sourceLabel: 'Musefold 创建',
      fidelity: 'adapted',
      currentRevisionId: 'dsrv_1',
      workingDraftRevisionId: null,
      inputLabels: [],
      coverAssetId: null,
      coverImagePath: null,
      hasSuccessfulTrial: false,
      lastRunAt: null,
      createdAt: 1,
      updatedAt: 1,
      creationSummary: '已生成草稿',
    }, []);
    expect(useGenerationWorkbenchStore.getState().isGenerating).toBe(false);

    // 草稿未试运行，直接开新对话——对话应被保留而不是丢失。
    useGenerationWorkbenchStore.getState().newSession();
    expect(useGenerationWorkbenchStore.getState().turns).toEqual([]);

    // 数据库中该会话没有 runs（方案创建轮不落库），但内存缓存能完整恢复。
    mocks.sessionGet.mockResolvedValue({
      session: { id: creationSessionId, title: '做一个海报方案', createdAt: 1, updatedAt: 1 },
      runs: [],
    });
    await useGenerationWorkbenchStore.getState().openSession(creationSessionId);
    const restored = useGenerationWorkbenchStore.getState();
    expect(restored.turns).toHaveLength(1);
    expect(restored.turns[0].source.kind).toBe('scheme-creation');
    expect(restored.turns[0].source).toMatchObject({
      state: 'draft_ready',
      draft: expect.objectContaining({ name: '极简海报' }),
    });
  });
});
