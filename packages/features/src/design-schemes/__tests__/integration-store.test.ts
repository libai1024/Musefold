import type {
  DesignSchemeDetail,
  DesignSchemeDetailRevisionSelector,
  DesignSchemeRevisionDocument,
  DesignSchemeSummary,
  InputSlot,
} from '@musefold/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildSchemeCreateSeedFromPrompt,
  buildSchemeHistorySeed,
  resolveSchemeAttachment,
  schemeAttachmentReadiness,
  useSchemeIntegration,
} from '../integration-store';

const NOW = '2026-08-30T08:00:00.000Z';

function makeSummary(overrides: Partial<DesignSchemeSummary> = {}): DesignSchemeSummary {
  return {
    id: 'scheme-1',
    name: '水彩海报',
    summary: '柔和水彩质感的活动海报配方',
    status: 'draft',
    sourcePresentation: 'musefold-created',
    sourceLabel: 'Musefold 创建',
    currentRevisionId: 'rev-1',
    version: 1,
    workingDraftRevisionId: null,
    coverAssetId: null,
    fidelity: 'faithful',
    inputLabels: [],
    hasSuccessfulTrial: false,
    lastRunAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeDocument(
  overrides: Partial<DesignSchemeRevisionDocument> = {},
): DesignSchemeRevisionDocument {
  return {
    schemaVersion: 1,
    revisionId: 'rev-1',
    schemeId: 'scheme-1',
    name: '水彩海报',
    summary: '柔和水彩质感的活动海报配方',
    fidelity: 'faithful',
    sources: [],
    sourceSnapshotIds: [],
    inputs: [],
    parameters: [],
    constraints: [],
    promptProgram: [
      {
        id: 'pm-1',
        order: 0,
        kind: 'input-template',
        template: '画一幅 {{subject}} 的水彩海报',
        variables: ['subject'],
        sourceIds: [],
      },
    ],
    assetIds: [],
    compilation: {
      compiledAt: NOW,
      model: { model: 'test-model' },
      adopted: [],
      omitted: [],
      warnings: [],
      trace: [],
    },
    parentRevisionId: null,
    createdBy: 'agent',
    createdAt: NOW,
    ...overrides,
  };
}

function textSlot(id: string, required: boolean): InputSlot {
  return { id, label: id, kind: 'text', required };
}

beforeEach(() => {
  useSchemeIntegration.getState().consumeWorkbenchIntent();
});

describe('useSchemeIntegration 一次性意图', () => {
  it('写入后消费一次即清;重复消费返回 null', () => {
    const store = useSchemeIntegration.getState();
    store.setWorkbenchIntent({ kind: 'create', createKind: 'idea', seed: '', source: null });
    const first = useSchemeIntegration.getState().consumeWorkbenchIntent();
    expect(first).toEqual({ kind: 'create', createKind: 'idea', seed: '', source: null });
    expect(useSchemeIntegration.getState().consumeWorkbenchIntent()).toBeNull();
    expect(useSchemeIntegration.getState().workbenchIntent).toBeNull();
  });

  it('后写入的意图覆盖先写入的(单槽位,最新一次导航生效)', () => {
    const store = useSchemeIntegration.getState();
    store.setWorkbenchIntent({ kind: 'create', createKind: 'idea', seed: '', source: null });
    store.setWorkbenchIntent({ kind: 'create', createKind: 'github', seed: 'x', source: null });
    expect(useSchemeIntegration.getState().consumeWorkbenchIntent()?.kind).toBe('create');
    expect(useSchemeIntegration.getState().workbenchIntent).toBeNull();
  });
});

describe('buildSchemeCreateSeedFromPrompt(逐字承 v2.1)', () => {
  it('指令行 + 正文 + 可选「避免:反向词」', () => {
    const withNegative = buildSchemeCreateSeedFromPrompt({
      content: '画一只水彩猫',
      negative: '低清晰度',
    });
    expect(withNegative).toBe(
      '把这段提示词整理成一个可以反复使用的方案，区分固定规则、必需变量和本次补充。\n\n画一只水彩猫\n\n避免：低清晰度',
    );
    const without = buildSchemeCreateSeedFromPrompt({ content: '画一只水彩猫', negative: null });
    expect(without).toBe(
      '把这段提示词整理成一个可以反复使用的方案，区分固定规则、必需变量和本次补充。\n\n画一只水彩猫',
    );
  });
});

describe('buildSchemeHistorySeed', () => {
  it('种子 = 选取层编辑的提取说明(trim);选择集不进正文', () => {
    const seed = buildSchemeHistorySeed({
      items: [{ jobId: 'job-1', assetUrl: 'media://a.png', prompt: '一只猫' }],
      note: '  保留构图，不保留主体。\n',
    });
    expect(seed).toBe('保留构图，不保留主体。');
  });
});

describe('schemeAttachmentReadiness 必需输入收集', () => {
  it('必需文本槽位为空 → 未就绪并点名;填齐后就绪', () => {
    const attachment = {
      mode: 'formal' as const,
      inputs: [textSlot('subject', true), textSlot('style', false)],
    };
    const missing = schemeAttachmentReadiness(attachment, {}, 0);
    expect(missing.ready).toBe(false);
    expect(missing.missing).toEqual(['subject']);
    expect(schemeAttachmentReadiness(attachment, { subject: ' 猫 ' }, 0).ready).toBe(true);
    // 纯空白不算已填。
    expect(schemeAttachmentReadiness(attachment, { subject: '   ' }, 0).ready).toBe(false);
  });

  it('必需图片槽位按声明顺序占用就绪参考图(承旧 assignedImages)', () => {
    const attachment = {
      mode: 'trial' as const,
      inputs: [
        { id: 'main', label: '主图', kind: 'image' as const, required: true },
        {
          id: 'refs',
          label: '参考组',
          kind: 'image-set' as const,
          required: true,
          minItems: 2,
        },
        { id: 'opt', label: '可选图', kind: 'image' as const, required: false },
      ],
    };
    // 需要 1 + 2 = 3 张就绪参考图;可选槽位不挡提交。
    expect(schemeAttachmentReadiness(attachment, {}, 2).missing).toEqual(['参考组']);
    expect(schemeAttachmentReadiness(attachment, {}, 3).ready).toBe(true);
  });

  it('modify 模式不收集运行输入(规范 §8.3),直接就绪', () => {
    const attachment = { mode: 'modify' as const, inputs: [textSlot('subject', true)] };
    expect(schemeAttachmentReadiness(attachment, {}, 0)).toEqual({ ready: true, missing: [] });
  });
});

describe('resolveSchemeAttachment(承旧 run-store.attach)', () => {
  function makeSelectorGateway(options: { workingDraftRevisionId?: string | null } = {}) {
    const current: DesignSchemeDetail = {
      summary: makeSummary({
        name: '新名字',
        hasSuccessfulTrial: true,
        workingDraftRevisionId: options.workingDraftRevisionId ?? null,
      }),
      document: makeDocument({ revisionId: 'rev-1', inputs: [textSlot('subject', true)] }),
      assets: [],
      sourceSnapshots: [],
    };
    const workingDraft: DesignSchemeDetail = {
      ...current,
      document: makeDocument({
        revisionId: 'rev-2',
        parentRevisionId: 'rev-1',
        inputs: [textSlot('draft-subject', true)],
      }),
    };
    const get = vi.fn(async (_id: string, revision: DesignSchemeDetailRevisionSelector) =>
      revision.kind === 'working-draft' ? workingDraft : current,
    );
    return { gateway: { get }, get };
  }

  it('formal 总是绑定最新 current，不受 working draft 影响', async () => {
    const { gateway, get } = makeSelectorGateway({ workingDraftRevisionId: 'rev-2' });
    const attachment = await resolveSchemeAttachment(gateway, makeSummary(), 'formal');

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('scheme-1', { kind: 'current' });
    expect(attachment.revisionId).toBe('rev-1');
  });

  it.each(['trial', 'modify'] as const)(
    '%s 在最新 summary 存在 working draft 时绑定 exact revision',
    async (mode) => {
      const { gateway, get } = makeSelectorGateway({ workingDraftRevisionId: 'rev-2' });
      const attachment = await resolveSchemeAttachment(gateway, makeSummary(), mode);

      expect(get).toHaveBeenNthCalledWith(1, 'scheme-1', { kind: 'current' });
      expect(get).toHaveBeenNthCalledWith(2, 'scheme-1', {
        kind: 'working-draft',
        revisionId: 'rev-2',
      });
      expect(attachment).toMatchObject({ mode, revisionId: 'rev-2' });
      expect(attachment.inputs[0]?.id).toBe('draft-subject');
    },
  );

  it('trial 没有 working draft 时回退到 latest current', async () => {
    const stale = makeSummary({ name: '旧名字', currentRevisionId: 'rev-old' });
    const { gateway, get } = makeSelectorGateway();
    const attachment = await resolveSchemeAttachment(gateway, stale, 'trial');

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('scheme-1', { kind: 'current' });
    expect(attachment).toMatchObject({
      schemeId: 'scheme-1',
      revisionId: 'rev-1',
      name: '水彩海报',
      mode: 'trial',
      hasSuccessfulTrial: true,
    });
    expect(attachment.inputs).toHaveLength(1);
  });

  it('详情读取失败时原样抛错(集成层负责 toast,不写意图)', async () => {
    const gateway = {
      get: vi.fn(async () => {
        throw new Error('REVISION_NOT_FOUND');
      }),
    };
    await expect(resolveSchemeAttachment(gateway, makeSummary(), 'formal')).rejects.toThrow(
      'REVISION_NOT_FOUND',
    );
  });
});
