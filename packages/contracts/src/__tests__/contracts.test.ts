import { describe, expect, it } from 'vitest';
import {
  appPreferencesPatchSchema,
  appPreferencesSchema,
  cloudGenerationRequestSchema,
  defaultAppPreferences,
  createGenerationInputSchema,
  createWorkbenchSessionSchema,
  desktopSyncConsentSchema,
  desktopSyncPhaseSchema,
  desktopSyncStatusSchema,
  resolveSyncConflictInputSchema,
  syncConflictListSchema,
  syncConflictResolutionSchema,
  syncConflictSummarySchema,
  generationAssetUrlSchema,
  generationCleanupInputSchema,
  generationCleanupResultSchema,
  generationIdempotencyKeySchema,
  generationJobSchema,
  generationStorageUsageSchema,
  generationReferenceImageSchema,
  mcpConnectionSchema,
  promptDocumentSchema,
  promptListQuerySchema,
  promptReferenceSelectionSchema,
  promptReferenceSelectionsSchema,
  promptReferenceSelectionRangeSchema,
  promptReferenceSnapshotSchema,
  registerRequestSchema,
  saveAssetInputSchema,
  saveAssetResultSchema,
  updateMcpConnectionSchema,
  updateWorkbenchSessionSchema,
  uploadReferenceImageInputSchema,
  generationHistoryQuerySchema,
  workbenchDraftSchema,
  workbenchSessionListQuerySchema,
} from '../index';

describe('cloud-safe contracts', () => {
  it('validates three-state desktop sync consent and runtime phases', () => {
    expect(desktopSyncConsentSchema.parse('unset')).toBe('unset');
    expect(desktopSyncConsentSchema.parse('enabled')).toBe('enabled');
    expect(desktopSyncConsentSchema.parse('paused')).toBe('paused');
    expect(desktopSyncConsentSchema.safeParse('disabled').success).toBe(false);

    for (const phase of [
      'signed_out',
      'awaiting_consent',
      'paused',
      'enabling',
      'idle',
      'syncing',
      'conflict',
      'auth_blocked',
      'error',
    ]) {
      expect(desktopSyncPhaseSchema.safeParse(phase).success).toBe(true);
    }

    const legacy = {
      enabled: false,
      state: 'disabled' as const,
      account: null,
      lastSyncedAt: null,
      pendingMutations: 0,
      conflicts: 0,
      error: null,
    };
    expect(desktopSyncStatusSchema.parse(legacy)).toMatchObject({
      consent: 'unset',
      phase: 'signed_out',
    });
    expect(desktopSyncStatusSchema.safeParse({ ...legacy, unexpected: true }).success).toBe(false);
    expect(
      desktopSyncStatusSchema.parse({
        ...legacy,
        account: { username: 'user', deviceName: 'Mac' },
        consent: 'paused',
      }),
    ).toMatchObject({ consent: 'paused', phase: 'paused' });
  });

  it('keeps conflict summaries strict and ties duplicate capability to prompts', () => {
    const remoteSnapshot = {
      id: 'prompt-1',
      title: 'Conflict prompt',
      description: null,
      content: 'remote content',
      negative: null,
      folderId: null,
      tags: [],
      modelId: null,
      params: null,
      rating: 0,
      isPinned: false,
      pinOrder: null,
      usageCount: 0,
      lastUsedAt: null,
      source: 'manual' as const,
      sourceUrl: null,
      version: 1,
      createdAt: '2026-08-29T00:00:00+00:00',
      updatedAt: '2026-08-29T00:00:00+00:00',
      deletedAt: null,
    };
    // 真实 repository localSnapshot 是 outbox payload,不要求云实体的 id/version/timestamps。
    const localSnapshot = { title: 'Local title', content: 'local content', folderId: null };
    const promptConflict = {
      id: 'conflict-1',
      entityType: 'prompt' as const,
      entityId: 'prompt-1',
      localSnapshot,
      remoteSnapshot,
      createdAt: '2026-08-29T00:00:00+00:00',
      canDuplicate: true as const,
    };
    expect(syncConflictSummarySchema.parse(promptConflict)).toEqual(promptConflict);
    expect(syncConflictListSchema.parse([promptConflict])).toHaveLength(1);
    expect(
      syncConflictSummarySchema.safeParse({ ...promptConflict, ownerId: 'owner-1' }).success,
    ).toBe(false);
    expect(
      syncConflictSummarySchema.safeParse({ ...promptConflict, workspaceId: 'workspace-1' })
        .success,
    ).toBe(false);
    expect(
      syncConflictSummarySchema.safeParse({ ...promptConflict, canDuplicate: false }).success,
    ).toBe(false);
    expect(
      syncConflictSummarySchema.safeParse({
        ...promptConflict,
        entityType: 'folder',
        canDuplicate: true,
      }).success,
    ).toBe(false);
    expect(
      resolveSyncConflictInputSchema.parse({ conflictId: 'conflict-1', resolution: 'remote' }),
    ).toEqual({ conflictId: 'conflict-1', resolution: 'remote' });
    expect(syncConflictResolutionSchema.safeParse('nope').success).toBe(false);
    expect(
      resolveSyncConflictInputSchema.safeParse({
        conflictId: 'conflict-1',
        resolution: 'remote',
        workspaceId: 'workspace-1',
      }).success,
    ).toBe(false);
  });

  it('keeps conflict local payloads renderer-safe and entity-specific', () => {
    const createdAt = '2026-08-29T00:00:00+00:00';
    const promptConflict = {
      id: 'conflict-prompt',
      entityType: 'prompt' as const,
      entityId: 'prompt-1',
      localSnapshot: {},
      remoteSnapshot: {
        id: 'prompt-1',
        title: 'Remote prompt',
        description: null,
        content: 'remote content',
        negative: null,
        folderId: null,
        tags: [],
        modelId: null,
        params: null,
        rating: 0,
        isPinned: false,
        pinOrder: null,
        usageCount: 0,
        lastUsedAt: null,
        source: 'manual' as const,
        sourceUrl: null,
        version: 1,
        createdAt,
        updatedAt: createdAt,
        deletedAt: null,
      },
      createdAt,
      canDuplicate: true as const,
    };
    const folderConflict = {
      id: 'conflict-folder',
      entityType: 'folder' as const,
      entityId: 'folder-1',
      localSnapshot: {},
      remoteSnapshot: {
        id: 'folder-1',
        name: 'Remote folder',
        parentId: null,
        sortOrder: 0,
        version: 1,
        createdAt,
        updatedAt: createdAt,
        deletedAt: null,
      },
      createdAt,
      canDuplicate: false as const,
    };
    const tagConflict = {
      id: 'conflict-tag',
      entityType: 'tag' as const,
      entityId: 'tag-1',
      localSnapshot: {},
      remoteSnapshot: {
        id: 'tag-1',
        name: 'Remote tag',
        group: null,
        color: null,
        version: 1,
        createdAt,
        updatedAt: createdAt,
        deletedAt: null,
      },
      createdAt,
      canDuplicate: false as const,
    };

    expect(
      syncConflictListSchema.parse([promptConflict, folderConflict, tagConflict]),
    ).toHaveLength(3);

    for (const forbiddenField of ['localPath', 'apiKey', 'token', 'ownerId', 'workspaceId']) {
      expect(
        syncConflictSummarySchema.safeParse({
          ...promptConflict,
          localSnapshot: { [forbiddenField]: 'private' },
        }).success,
      ).toBe(false);
    }

    for (const forbiddenField of ['apiKey', 'token', 'ownerId', 'workspaceId', 'imagePath']) {
      expect(
        syncConflictSummarySchema.safeParse({
          ...promptConflict,
          localSnapshot: { params: { nested: { [forbiddenField]: 'private' } } },
        }).success,
      ).toBe(false);
    }

    for (const forbiddenField of [
      'api__key',
      'authorization',
      'private_key',
      'signing_key',
      'passwd',
    ]) {
      expect(
        syncConflictSummarySchema.safeParse({
          ...promptConflict,
          localSnapshot: { params: { [forbiddenField]: 'private' } },
        }).success,
      ).toBe(false);
    }
    expect(
      syncConflictSummarySchema.safeParse({
        ...promptConflict,
        localSnapshot: { params: { max_tokens: 128 } },
      }).success,
    ).toBe(true);

    for (const localPath of [
      '/Users/person/private.png',
      '/home/person/private.png',
      '/var/lib/musefold/private.png',
      '/private/var/folders/private.png',
      '/Volumes/External/private.png',
      'C:\\Users\\person\\private.png',
      '\\\\server\\private.png',
      'file:///Users/person/private.png',
    ]) {
      expect(
        syncConflictSummarySchema.safeParse({
          ...promptConflict,
          localSnapshot: { params: { reference: localPath } },
        }).success,
      ).toBe(false);
    }

    expect(
      syncConflictSummarySchema.safeParse({
        ...promptConflict,
        localSnapshot: { params: { references: ['/Users/person/private.png'] } },
      }).success,
    ).toBe(false);
    expect(
      syncConflictSummarySchema.safeParse({
        ...promptConflict,
        localSnapshot: { sourceUrl: 'file:///Users/person/private.png' },
      }).success,
    ).toBe(false);
    expect(
      syncConflictSummarySchema.safeParse({
        ...promptConflict,
        localSnapshot: { sourceUrl: 'https://example.com/prompt' },
      }).success,
    ).toBe(true);
    expect(
      syncConflictSummarySchema.safeParse({
        ...folderConflict,
        localSnapshot: { content: 'prompt-only' },
      }).success,
    ).toBe(false);
    expect(
      syncConflictSummarySchema.safeParse({
        ...tagConflict,
        localSnapshot: { sortOrder: 2 },
      }).success,
    ).toBe(false);
    expect(
      syncConflictSummarySchema.safeParse({
        ...promptConflict,
        localSnapshot: { group: 'tag-only' },
      }).success,
    ).toBe(false);
  });

  it('applies stable list and generation defaults', () => {
    expect(promptListQuerySchema.parse({})).toMatchObject({
      limit: 20,
      includeDeleted: false,
      sort: 'updated-desc',
    });
    expect(cloudGenerationRequestSchema.parse({ prompt: 'paper collage' })).toMatchObject({
      size: 'auto',
      quality: 'auto',
      count: 1,
    });
  });

  it('validates generation idempotency keys against the API wire grammar', () => {
    expect(generationIdempotencyKeySchema.parse('intent-0001')).toBe('intent-0001');
    expect(generationIdempotencyKeySchema.safeParse('short').success).toBe(false);
    expect(generationIdempotencyKeySchema.safeParse('x'.repeat(129)).success).toBe(false);
    expect(generationIdempotencyKeySchema.safeParse('intent-\n001').success).toBe(false);
  });

  it('keeps canonical aspect ratios strict for new client creates', () => {
    for (const aspectRatio of ['1:4', '4:1', '16:9', '7:3']) {
      expect(createGenerationInputSchema.safeParse({ prompt: 'p', aspectRatio }).success).toBe(
        true,
      );
    }
    for (const aspectRatio of ['99:1', '1:5', '0:1', '1:0', '01:04', 'custom:7:3', 'wide']) {
      expect(createGenerationInputSchema.safeParse({ prompt: 'p', aspectRatio }).success).toBe(
        false,
      );
    }
  });

  it('keeps persisted ratio rows backward-readable while raw creates stay canonical', () => {
    expect(
      cloudGenerationRequestSchema.parse({ prompt: 'legacy', aspectRatio: '01:04' }).aspectRatio,
    ).toBe('01:04');
    expect(
      cloudGenerationRequestSchema.parse({ prompt: 'legacy', aspectRatio: '99:1' }).aspectRatio,
    ).toBe('99:1');
    expect(
      createGenerationInputSchema.safeParse({ prompt: 'new', aspectRatio: '01:04' }).success,
    ).toBe(false);
    expect(
      createGenerationInputSchema.safeParse({ prompt: 'new', aspectRatio: '99:1' }).success,
    ).toBe(false);
    expect(
      createGenerationInputSchema.safeParse({ prompt: 'new', aspectRatio: '7:3' }).success,
    ).toBe(true);
    expect(
      createGenerationInputSchema.parse({ prompt: 'new', aspectRatio: '2:8' }).aspectRatio,
    ).toBe('1:4');
    expect(
      createGenerationInputSchema.parse({ prompt: 'new', aspectRatio: '1:4' }).aspectRatio,
    ).toBe('1:4');
    expect(
      createGenerationInputSchema.parse({ prompt: 'new', aspectRatio: '7:3' }).aspectRatio,
    ).toBe('7:3');
    expect(cloudGenerationRequestSchema.safeParse({ prompt: 'x'.repeat(12_000) }).success).toBe(
      true,
    );
    expect(cloudGenerationRequestSchema.safeParse({ prompt: 'x'.repeat(12_001) }).success).toBe(
      false,
    );
    expect(createGenerationInputSchema.safeParse({ prompt: 'x'.repeat(8_000) }).success).toBe(true);
    expect(createGenerationInputSchema.safeParse({ prompt: 'x'.repeat(8_001) }).success).toBe(
      false,
    );
  });

  it('validates prompt reference selection intent without trusting renderer text', () => {
    const full = { promptId: 'prompt-1', scope: 'full', expectedVersion: 2 } as const;
    const excerpt = {
      promptId: 'prompt-2',
      scope: 'excerpt',
      expectedVersion: 3,
      range: { start: 2, end: 8 },
    } as const;
    expect(promptReferenceSelectionSchema.parse(full)).toEqual(full);
    expect(promptReferenceSelectionSchema.parse(excerpt)).toEqual(excerpt);
    expect(
      promptReferenceSelectionSchema.safeParse({ ...full, range: { start: 0, end: 1 } }).success,
    ).toBe(false);
    expect(
      promptReferenceSelectionSchema.safeParse({
        promptId: 'prompt-1',
        scope: 'excerpt',
        expectedVersion: 1,
      }).success,
    ).toBe(false);
    expect(
      promptReferenceSelectionSchema.safeParse({ ...full, title: 'forged', text: 'forged' })
        .success,
    ).toBe(false);
    expect(promptReferenceSelectionRangeSchema.safeParse({ start: 4, end: 4 }).success).toBe(false);
    expect(promptReferenceSelectionRangeSchema.safeParse({ start: -1, end: 1 }).success).toBe(
      false,
    );
    // Coordinates are UTF-16 code units: an astral symbol occupies two coordinate units.
    expect(promptReferenceSelectionRangeSchema.parse({ start: 0, end: 2 })).toEqual({
      start: 0,
      end: 2,
    });
    expect(promptReferenceSelectionRangeSchema.safeParse({ start: 0, end: 12_000 }).success).toBe(
      true,
    );
    expect(promptReferenceSelectionRangeSchema.safeParse({ start: 0, end: 12_001 }).success).toBe(
      false,
    );
  });

  it('supports reference-only creates and enforces the six-selection limit', () => {
    const selection = { promptId: 'prompt-1', scope: 'full', expectedVersion: 1 } as const;
    expect(
      createGenerationInputSchema.parse({ prompt: '', promptReferenceSelections: [selection] }),
    ).toMatchObject({
      prompt: '',
      promptReferenceSelections: [selection],
    });
    expect(createGenerationInputSchema.safeParse({ prompt: '   ' }).success).toBe(false);
    expect(
      createGenerationInputSchema.safeParse({
        prompt: '',
        promptReferenceSelections: Array.from({ length: 7 }, (_, index) => ({
          promptId: `prompt-${index}`,
          scope: 'full' as const,
          expectedVersion: 1,
        })),
      }).success,
    ).toBe(false);
    expect(promptReferenceSelectionsSchema.safeParse([]).success).toBe(true);
  });

  it('keeps legacy workbench drafts unchanged while defaulting reference intents', () => {
    expect(
      workbenchDraftSchema.parse({
        prompt: 'legacy prompt',
        negative: '',
        params: {},
        promptReferenceIds: ['legacy-prompt'],
      }),
    ).toMatchObject({
      prompt: 'legacy prompt',
      promptReferenceIds: ['legacy-prompt'],
      promptReferenceSelections: [],
    });
    expect(workbenchDraftSchema.parse({ prompt: '', negative: '', params: {} })).toMatchObject({
      promptReferenceIds: [],
      promptReferenceSelections: [],
    });
    expect(
      workbenchDraftSchema.safeParse({
        prompt: 'x'.repeat(12_000),
        negative: '',
        params: {},
      }).success,
    ).toBe(true);
    expect(
      workbenchDraftSchema.safeParse({
        prompt: 'x'.repeat(12_001),
        negative: '',
        params: {},
      }).success,
    ).toBe(false);
    expect(
      workbenchDraftSchema.safeParse({
        prompt: 'draft',
        negative: '',
        params: { aspectRatio: '99:1' },
        promptReferenceIds: [],
      }).success,
    ).toBe(true);
    expect(
      workbenchDraftSchema.safeParse({
        prompt: 'draft',
        negative: '',
        params: { aspectRatio: '01:04' },
      }).success,
    ).toBe(true);
    expect(
      createWorkbenchSessionSchema.safeParse({
        draft: { prompt: 'draft', negative: '', params: { aspectRatio: '99:1' } },
      }).success,
    ).toBe(false);
    expect(
      updateWorkbenchSessionSchema.safeParse({
        expectedVersion: 1,
        draft: { prompt: 'draft', negative: '', params: { aspectRatio: '01:04' } },
      }).success,
    ).toBe(false);
    expect(
      createWorkbenchSessionSchema.parse({
        draft: { prompt: 'draft', negative: '', params: { aspectRatio: '2:8' } },
      }).draft.params?.aspectRatio,
    ).toBe('1:4');
    expect(
      workbenchDraftSchema.parse({
        prompt: 'draft',
        negative: '',
        params: { aspectRatio: '2:8' },
      }).params.aspectRatio,
    ).toBe('2:8');
  });

  it('keeps immutable snapshots strict and permits hard-deleted source links', () => {
    const snapshot = {
      promptId: null,
      title: 'Frozen title',
      text: '  frozen text  ',
      scope: 'excerpt' as const,
      sourceVersion: 4,
    };
    expect(promptReferenceSnapshotSchema.parse(snapshot)).toMatchObject({
      promptId: null,
      text: 'frozen text',
    });
    expect(
      promptReferenceSnapshotSchema.safeParse({ ...snapshot, content: 'forged' }).success,
    ).toBe(false);
  });

  it('keeps legacy generation jobs readable and defaults frozen timeline fields', () => {
    const legacyJob = {
      id: 'job-1',
      sessionId: null,
      parentRunId: null,
      promptId: null,
      actorType: 'web',
      approvalStatus: 'not_required',
      status: 'succeeded',
      progress: 100,
      request: { prompt: 'legacy request' },
      providerModel: null,
      costPoints: null,
      assets: [],
      error: null,
      createdAt: '2026-08-18T00:00:00.000Z',
      startedAt: null,
      finishedAt: '2026-08-18T00:00:00.000Z',
    } as const;
    expect(generationJobSchema.parse(legacyJob)).toMatchObject({
      request: { prompt: 'legacy request' },
      promptReferences: [],
    });
    expect(generationJobSchema.parse(legacyJob)).not.toHaveProperty('userPrompt');
    const referenceOnlyJob = generationJobSchema.parse({
      ...legacyJob,
      userPrompt: '',
      promptReferences: [
        {
          promptId: 'prompt-1',
          title: 'Source',
          text: 'Reference text',
          scope: 'full',
          sourceVersion: 1,
        },
      ],
    });
    expect(referenceOnlyJob).toMatchObject({
      userPrompt: '',
      promptReferences: [{ promptId: 'prompt-1' }],
    });

    // 用时/种子是后加的展示字段:旧行缺省即缺席,消费方不得伪造 0(ui-parity 05 §7)。
    const legacyParsed = generationJobSchema.parse(legacyJob);
    expect(legacyParsed.durationMs).toBeUndefined();
    expect(legacyParsed.seed).toBeUndefined();
    const reported = generationJobSchema.parse({ ...legacyJob, durationMs: 1_500, seed: 42 });
    expect(reported).toMatchObject({ durationMs: 1_500, seed: 42 });
    // provider 回报不透明串也合法;负用时与超长串拒绝。
    expect(generationJobSchema.parse({ ...legacyJob, seed: 'abc-1' }).seed).toBe('abc-1');
    expect(generationJobSchema.parse({ ...legacyJob, durationMs: null }).durationMs).toBeNull();
    expect(generationJobSchema.safeParse({ ...legacyJob, durationMs: -1 }).success).toBe(false);
    expect(generationJobSchema.safeParse({ ...legacyJob, durationMs: 1.5 }).success).toBe(false);
    expect(generationJobSchema.safeParse({ ...legacyJob, seed: 'x'.repeat(65) }).success).toBe(
      false,
    );
  });

  it('locks the batch cleanup scopes and aggregate readouts (ui-parity 05 §7)', () => {
    for (const scope of ['older-than-30d', 'failed-and-cancelled', 'empty-trash'] as const) {
      expect(generationCleanupInputSchema.parse({ scope })).toEqual({ scope });
    }
    expect(generationCleanupInputSchema.safeParse({ scope: 'all' }).success).toBe(false);
    // strict:多带字段拒绝,避免调用方偷偷扩大清理范围。
    expect(
      generationCleanupInputSchema.safeParse({ scope: 'empty-trash', sessionId: 's1' }).success,
    ).toBe(false);

    expect(generationCleanupResultSchema.parse({ affected: 0 })).toEqual({ affected: 0 });
    expect(generationCleanupResultSchema.safeParse({ affected: -1 }).success).toBe(false);

    expect(generationStorageUsageSchema.parse({ bytes: 1024, fileCount: 2 })).toEqual({
      bytes: 1024,
      fileCount: 2,
    });
    // 只报聚合数字:绝对路径一类字段不得混进来(渲染层无路径概念)。
    expect(
      generationStorageUsageSchema.safeParse({ bytes: 1, fileCount: 1, dir: '/Users/x/Pictures' })
        .success,
    ).toBe(false);
  });

  it('accepts ISO bounds for the custom history range (ui-parity 05 §7)', () => {
    const parsed = generationHistoryQuerySchema.parse({
      from: '2026-03-02T00:00:00.000Z',
      to: '2026-03-04T23:59:59.999Z',
    });
    expect(parsed.from).toBe('2026-03-02T00:00:00.000Z');
    expect(parsed.to).toBe('2026-03-04T23:59:59.999Z');
    expect(generationHistoryQuerySchema.safeParse({ from: '2026-03-02' }).success).toBe(false);
  });

  it('upgrades legacy boolean reducedMotion archives to three-level motion', () => {
    const base = { theme: 'system', language: 'zh-CN' } as const;
    // v2.5 早期布尔存档:false(不减少)→ system,true(减少)→ on;缺字段 → system。
    expect(appPreferencesSchema.parse({ ...base, reducedMotion: false }).reducedMotion).toBe(
      'system',
    );
    expect(appPreferencesSchema.parse({ ...base, reducedMotion: true }).reducedMotion).toBe('on');
    expect(appPreferencesSchema.parse(base).reducedMotion).toBe('system');
    expect(appPreferencesSchema.parse({ ...base, reducedMotion: 'off' }).reducedMotion).toBe('off');
    expect(appPreferencesSchema.safeParse({ ...base, reducedMotion: 'fast' }).success).toBe(false);
  });

  it('defaults generation params and density on legacy preference archives', () => {
    const base = { theme: 'system', language: 'zh-CN' } as const;
    const upgraded = appPreferencesSchema.parse(base);
    expect(upgraded.defaultAspectRatio).toBe('auto');
    expect(upgraded.defaultQuality).toBe('auto');
    expect(upgraded.density).toBe('comfortable');
    expect(
      appPreferencesSchema.parse({ ...base, defaultAspectRatio: '16:8' }).defaultAspectRatio,
    ).toBe('2:1');
    expect(
      appPreferencesSchema.parse({ ...base, defaultQuality: 'high', density: 'compact' }),
    ).toMatchObject({ defaultQuality: 'high', density: 'compact' });
    expect(appPreferencesSchema.safeParse({ ...base, defaultAspectRatio: '99:1' }).success).toBe(
      false,
    );
    expect(appPreferencesSchema.safeParse({ ...base, density: 'dense' }).success).toBe(false);
    expect(appPreferencesSchema.safeParse({ ...base, defaultQuality: 'ultra' }).success).toBe(
      false,
    );
  });

  it('defaults the onboarding sentinel to null and only accepts offset ISO datetimes', () => {
    const base = { theme: 'system', language: 'zh-CN' } as const;
    // 存量存档缺字段 → null(未完成引导),首启 gate 因此仍可判定。
    expect(appPreferencesSchema.parse(base).onboardingCompletedAt).toBeNull();
    expect(defaultAppPreferences.onboardingCompletedAt).toBeNull();
    expect(
      appPreferencesSchema.parse({ ...base, onboardingCompletedAt: '2026-09-06T08:30:00+00:00' })
        .onboardingCompletedAt,
    ).toBe('2026-09-06T08:30:00+00:00');
    expect(
      appPreferencesSchema.safeParse({ ...base, onboardingCompletedAt: '2026-09-06' }).success,
    ).toBe(false);
    // patch 通道(gate 静默写哨兵 / 跳过写哨兵)接受单字段与 null 归零。
    expect(
      appPreferencesPatchSchema.parse({ onboardingCompletedAt: '2026-09-06T08:30:00+00:00' }),
    ).toMatchObject({ onboardingCompletedAt: '2026-09-06T08:30:00+00:00' });
    expect(appPreferencesPatchSchema.parse({ onboardingCompletedAt: null })).toMatchObject({
      onboardingCompletedAt: null,
    });
    expect(appPreferencesPatchSchema.safeParse({ onboardingCompletedAt: 'never' }).success).toBe(
      false,
    );
  });

  it('keeps absent fields absent in preference patches (no default back-fill)', () => {
    // 桌面 gateway-bridge 先用 patch 契约校验再 spread 到现存偏好;若 partial 回填默认值,
    // 改一次主题就会把置顶会话/密度/生成默认/引导哨兵全部重置。
    expect(appPreferencesPatchSchema.parse({ theme: 'dark' })).toEqual({ theme: 'dark' });
    expect(appPreferencesPatchSchema.parse({ pinnedSessionIds: ['s1'] })).toEqual({
      pinnedSessionIds: ['s1'],
    });
    expect(appPreferencesPatchSchema.parse({})).toEqual({});
    // legacy 布尔 reducedMotion 预处理仍在 patch 通道生效。
    expect(appPreferencesPatchSchema.parse({ reducedMotion: true })).toEqual({
      reducedMotion: 'on',
    });
    // patch 键集合与完整偏好键集合一致(新增偏好字段自动进入 patch 契约)。
    expect(Object.keys(appPreferencesPatchSchema.shape).sort()).toEqual(
      Object.keys(appPreferencesSchema.shape).sort(),
    );
    expect(appPreferencesPatchSchema.safeParse({ density: 'dense' }).success).toBe(false);
  });

  it('defaults referenceImages and bounds reference uploads', () => {
    // 旧存量请求(无字段)解析后补空数组,wire 无损兼容。
    expect(cloudGenerationRequestSchema.parse({ prompt: 'paper collage' }).referenceImages).toEqual(
      [],
    );
    const reference = {
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      url: 'media://local/?p=%2Ftmp%2Fref.png',
      name: 'ref.png',
      mimeType: 'image/png',
      byteSize: 1024,
    };
    expect(
      cloudGenerationRequestSchema.parse({ prompt: 'p', referenceImages: [reference] })
        .referenceImages,
    ).toHaveLength(1);
    // id 是宿主内定位符,不允许路径分隔符等自由字符。
    expect(
      generationReferenceImageSchema.safeParse({ ...reference, id: '../escape' }).success,
    ).toBe(false);
    expect(
      cloudGenerationRequestSchema.safeParse({
        prompt: 'p',
        referenceImages: Array.from({ length: 17 }, () => reference),
      }).success,
    ).toBe(false);
    // 上传入参:空字节与超限字节都拒绝。
    expect(
      uploadReferenceImageInputSchema.safeParse({ name: 'a.png', bytes: new Uint8Array(0) })
        .success,
    ).toBe(false);
    expect(
      uploadReferenceImageInputSchema.safeParse({ name: 'a.png', bytes: new Uint8Array(8) })
        .success,
    ).toBe(true);
  });

  it('validates save-asset input and result', () => {
    expect(
      saveAssetInputSchema.safeParse({
        url: 'media://local/?p=%2Fpics%2Fa.png',
        name: 'musefold-a.png',
      }).success,
    ).toBe(true);
    // 空文件名拒绝。
    expect(
      saveAssetInputSchema.safeParse({ url: 'https://cdn.test/a.png', name: '  ' }).success,
    ).toBe(false);
    expect(saveAssetResultSchema.parse('cancelled')).toBe('cancelled');
    expect(saveAssetResultSchema.safeParse('done').success).toBe(false);
  });

  it('keeps providerId but strips undeclared desktop-only fields', () => {
    // providerId 是跨端合法字段(桌面选本地连接,云端忽略);路径类字段不进契约。
    const parsed = cloudGenerationRequestSchema.parse({
      prompt: 'paper collage',
      providerId: 'local-provider',
      imagePath: '/tmp/result.png',
    });
    expect(parsed.providerId).toBe('local-provider');
    expect(parsed).not.toHaveProperty('imagePath');
  });

  it('accepts history filter bounds and keeps list defaults', () => {
    expect(
      generationHistoryQuerySchema.parse({
        status: 'failed',
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-31T23:59:59.999Z',
        providerModel: 'musefold-image-pro',
        search: '建筑',
      }),
    ).toMatchObject({
      limit: 20,
      includeDeleted: false,
      status: 'failed',
      providerModel: 'musefold-image-pro',
    });
    expect(generationHistoryQuerySchema.safeParse({ status: 'success' }).success).toBe(false);
  });

  it('defaults and parses the archived-only workbench list filter', () => {
    expect(workbenchSessionListQuerySchema.parse({})).toMatchObject({
      limit: 20,
      includeArchived: false,
      includeDeleted: false,
      archivedOnly: false,
    });
    expect(
      workbenchSessionListQuerySchema.parse({
        archivedOnly: 'true',
        includeArchived: false,
        includeDeleted: true,
      }),
    ).toMatchObject({
      archivedOnly: true,
      includeDeleted: true,
    });
    expect(workbenchSessionListQuerySchema.safeParse({ archivedOnly: 'invalid' }).success).toBe(
      false,
    );
  });

  it('strips non-contract registration fields', () => {
    expect(
      registerRequestSchema.parse({
        username: 'musefold',
        password: 'secret-password',
        displayName: 'not persisted',
      }),
    ).toEqual({ username: 'musefold', password: 'secret-password' });
  });

  it('requires versioned prompt records with valid timestamps', () => {
    const result = promptDocumentSchema.safeParse({
      id: '01K1TEST',
      title: 'Poster study',
      description: null,
      content: 'A quiet poster',
      negative: null,
      folderId: null,
      tags: [],
      modelId: null,
      params: null,
      isPinned: false,
      usageCount: 0,
      version: 0,
      createdAt: 'not-a-date',
      updatedAt: 'not-a-date',
      deletedAt: null,
    });
    expect(result.success).toBe(false);
  });

  it('accepts same-origin assets without allowing executable URLs', () => {
    expect(generationAssetUrlSchema.parse('/Musefold/app/assets/result.png')).toBe(
      '/Musefold/app/assets/result.png',
    );
    expect(generationAssetUrlSchema.parse('https://cdn.example.com/result.png')).toBe(
      'https://cdn.example.com/result.png',
    );
    expect(generationAssetUrlSchema.safeParse('javascript:alert(1)').success).toBe(false);
    expect(generationAssetUrlSchema.safeParse('//untrusted.example/result.png').success).toBe(
      false,
    );
  });

  it('keeps Cloud MCP spend statistics read-only and validates reauthentication', () => {
    const connection = mcpConnectionSchema.parse({
      id: 'connection-1',
      clientName: 'Codex',
      scopes: ['account:read'],
      mode: 'ask_each_time',
      maxPointsPerGeneration: 1_000,
      maxPointsPerDay: 5_000,
      spentPointsToday: 1_000,
      reservedPointsToday: 2_000,
      status: 'active',
      createdAt: '2026-08-18T00:00:00.000Z',
      lastUsedAt: null,
    });
    expect(connection).toMatchObject({
      spentPointsToday: 1_000,
      reservedPointsToday: 2_000,
    });
    const update = updateMcpConnectionSchema.parse({
      maxPointsPerDay: 8_000,
      scopes: ['account:read', 'prompts:read'],
      reauthPassword: 'current-password',
      spentPointsToday: 0,
    });
    expect(update).toEqual({
      maxPointsPerDay: 8_000,
      scopes: ['account:read', 'prompts:read'],
      reauthPassword: 'current-password',
    });
    expect(updateMcpConnectionSchema.safeParse({ reauthPassword: 'short' }).success).toBe(false);
    // v2：能力可编辑，但至少保留一项，且只接受已知 scope。
    expect(updateMcpConnectionSchema.safeParse({ scopes: [] }).success).toBe(false);
    expect(updateMcpConnectionSchema.safeParse({ scopes: ['prompts:admin'] }).success).toBe(false);
  });
});
