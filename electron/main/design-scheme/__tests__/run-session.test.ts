/**
 * 方案运行管线（run-session）单测：mock 掉真实生图（ipc/images.generate），
 * 用内存 SQLite 验证输入校验、编译、逐张生图、试运行资产与运行记录落库。
 */
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DESIGN_SCHEME_DOCUMENT_VERSION,
  type DesignSchemeRevisionDocument,
} from '@shared/design-scheme/schema';
import type {
  DesignSchemeCreationEvent,
  StartDesignSchemeRunRequest,
} from '@shared/types/design-scheme';
import type { GenerateImageRequest, GenerateImageResult } from '@shared/types/providers';
import { runDesignSchemeDbMigrations } from '@musefold/core/db/design-scheme/migrations';
import { DesignSchemeRepository } from '@musefold/core/db/design-scheme/repositories';
import { fakePngBuffer } from './evaluation.test';

const generateMock = vi.hoisted(() => vi.fn<(req: GenerateImageRequest) => Promise<GenerateImageResult>>());
vi.mock('../../ipc/images', () => ({ generate: (req: GenerateImageRequest) => generateMock(req) }));

import { runDesignScheme } from '../run-session';

const imagesDir = mkdtempSync(join(tmpdir(), 'musefold-run-session-'));

/** 生图 mock 落一个真实 PNG 文件，让质量门（statSync + 尺寸解析）有可检对象。 */
function successResult(jobId: string, width = 1024, height = 1024): GenerateImageResult {
  const imagePath = join(imagesDir, `${jobId}-${width}x${height}.png`);
  writeFileSync(imagePath, fakePngBuffer(width, height));
  return { historyId: jobId, status: 'success', imagePath };
}

function documentFixture(): DesignSchemeRevisionDocument {
  return {
    schemaVersion: DESIGN_SCHEME_DOCUMENT_VERSION,
    revisionId: 'dsrv_rs',
    schemeId: 'dsch_rs',
    name: '运行管线测试方案',
    summary: '单测夹具',
    fidelity: 'adapted',
    sources: [{ id: 'src_brief', kind: 'user-brief', role: 'context' }],
    inputs: [{ id: 'topic', label: '主题', kind: 'text', required: true }],
    parameters: [],
    constraints: [],
    promptProgram: [
      { id: 'pm_1', order: 0, kind: 'input-template', template: '为「{{topic}}」创作插画', variables: ['topic'], sourceIds: ['src_brief'] },
      { id: 'pm_2', order: 1, kind: 'style-rule', template: '手绘线条，暖色', variables: [], sourceIds: ['src_brief'] },
    ],
    compilation: {
      compiledAt: 1,
      model: { model: 'test', connectionName: 'test' },
      adopted: [],
      omitted: [],
      warnings: [],
      trace: [],
    },
  };
}

function runRequest(overrides: Partial<StartDesignSchemeRunRequest> = {}): StartDesignSchemeRunRequest {
  return {
    executionId: 'exec-1',
    schemeId: 'dsch_rs',
    revisionId: 'dsrv_rs',
    mode: 'trial',
    brief: '',
    inputValues: { topic: '夏日集市' },
    generation: {
      requestTemplate: {
        providerId: 'prov-1',
        prompt: '',
        size: 'auto',
        quality: 'high',
        n: 1,
      } as GenerateImageRequest,
      jobIds: ['job-a', 'job-b'],
      providerName: 'TvT image2',
      ratioId: 'auto',
    },
    ...overrides,
  };
}

describe('runDesignScheme', () => {
  let db: Database.Database;
  let events: DesignSchemeCreationEvent[];
  let controller: AbortController;

  const deps = () => ({
    db,
    emit: (event: DesignSchemeCreationEvent) => { events.push(event); },
    sendProgress: () => undefined,
    signal: controller.signal,
  });

  beforeEach(() => {
    db = new Database(':memory:');
    runDesignSchemeDbMigrations(db);
    new DesignSchemeRepository(db).insertSchemeDraft({
      document: documentFixture(),
      sourceLabel: 'Musefold 创建',
      sourcePresentation: 'musefold-created',
      createdBy: 'agent',
      bindings: [],
    });
    events = [];
    controller = new AbortController();
    generateMock.mockReset();
  });

  afterEach(() => {
    db.close();
  });

  it('试运行成功：编译提示词、逐张生图、成功结果进入草稿相册、质量门通过', async () => {
    generateMock.mockImplementation(async (req) => successResult(req.jobId ?? 'h'));

    const result = await runDesignScheme(runRequest(), deps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.compiledPrompt).toBe('为「夏日集市」创作插画\n\n手绘线条，暖色');
    expect(generateMock).toHaveBeenCalledTimes(2);
    // 模板 prompt 为空，主进程必须以编译结果覆盖，且逐张 n=1。
    for (const call of generateMock.mock.calls) {
      expect(call[0].prompt).toBe(result.data.compiledPrompt);
      expect(call[0].n).toBe(1);
    }
    expect(result.data.generations.map((item) => item.assetId).every(Boolean)).toBe(true);

    const repository = new DesignSchemeRepository(db);
    expect(repository.hasSuccessfulTrial('dsrv_rs')).toBe(true);
    const runRow = db.prepare('SELECT mode, status, policy_json FROM design_scheme_runs WHERE run_id = ?').get(result.data.runId) as { mode: string; status: string; policy_json: string };
    expect(runRow.mode).toBe('trial');
    expect(runRow.status).toBe('completed');
    // 缺省优先级按「方案主导」写入快照（设计规范 §4.3）。
    expect(JSON.parse(runRow.policy_json).priorityMode).toBe('scheme_first');

    // 质量门（§5.5）：结果携带评估、证据入库、轨迹有可读结论。
    expect(result.data.evaluation?.passed).toBe(true);
    expect(result.data.evaluation?.checks.map((check) => check.status)).toEqual(['pass', 'pass', 'pass']);
    const stored = repository.getRunEvaluation(result.data.runId);
    expect(stored?.passed).toBe(true);
    expect(stored?.evidence).toHaveLength(2);
    expect(result.data.trace.find((item) => item.id === 'quality-gate')?.status).toBe('success');

    // 事件序列：每张图先 start 后 result。
    const kinds = events.filter((event) => event.kind.startsWith('run-generation')).map((event) => event.kind);
    expect(kinds).toEqual(['run-generation-start', 'run-generation-result', 'run-generation-start', 'run-generation-result']);
  });

  it('质量门：部分成功/比例漂移记 warn，不改变运行结论', async () => {
    generateMock
      .mockImplementationOnce(async (req) => successResult(req.jobId ?? 'h', 1024, 1024))
      .mockImplementationOnce(async (req) => ({
        historyId: req.jobId ?? 'h',
        status: 'failed',
        error: { code: 'PROVIDER_ERROR', message: 'boom' },
      }));

    const result = await runDesignScheme(
      runRequest({ generation: { ...runRequest().generation, ratioId: '3:4' } }),
      deps(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 有成功输出 → run 仍 completed；质量门 warn 呈现在轨迹里。
    const runRow = db.prepare('SELECT status FROM design_scheme_runs WHERE run_id = ?').get(result.data.runId) as { status: string };
    expect(runRow.status).toBe('completed');
    expect(result.data.evaluation?.passed).toBe(true);
    expect(result.data.evaluation?.checks.find((check) => check.id === 'output-count')?.status).toBe('warn');
    expect(result.data.evaluation?.checks.find((check) => check.id === 'aspect-ratio')?.status).toBe('warn');
    expect(result.data.trace.find((item) => item.id === 'quality-gate')?.status).toBe('warning');
    // 有偏差 → 给出确定性修复建议（有限修复链入口）。
    expect(result.data.evaluation?.repairHint).toContain('3:4');
  });

  it('修复重跑：纠偏要求并入提示词、策略记录来源 runId、不再给二次建议', async () => {
    generateMock.mockImplementation(async (req) => successResult(req.jobId ?? 'h', 1024, 1024));

    const result = await runDesignScheme(
      runRequest({
        generation: { ...runRequest().generation, ratioId: '3:4', jobIds: ['job-r'] },
        repair: { ofRunId: 'dsr_prev', hint: '严格按照 3:4 的画面比例输出' },
      }),
      deps(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 建议作为修复要求进入编译提示词（方案文档不变）。
    expect(result.data.compiledPrompt).toContain('修复要求：严格按照 3:4 的画面比例输出');
    // 策略快照记录修复来源；原始运行不受影响。
    const runRow = db.prepare('SELECT policy_json FROM design_scheme_runs WHERE run_id = ?').get(result.data.runId) as { policy_json: string };
    expect(JSON.parse(runRow.policy_json).repairOfRunId).toBe('dsr_prev');
    // 输出仍是 1:1，比例检查仍 warn——但修复运行不再给建议（链长 1）。
    expect(result.data.evaluation?.checks.find((check) => check.id === 'aspect-ratio')?.status).toBe('warn');
    expect(result.data.evaluation?.repairHint).toBeNull();
    // 轨迹里有修复上下文条目。
    expect(result.data.trace.find((item) => item.id === 'repair-context')?.detail).toContain('3:4');
  });

  it('缺必填输入：blocked，不触发生图', async () => {
    const result = await runDesignScheme(runRequest({ inputValues: {} }), deps());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('主题');
    expect(generateMock).not.toHaveBeenCalled();
    const row = db.prepare("SELECT status FROM design_scheme_runs WHERE mode = 'trial'").get() as { status: string };
    expect(row.status).toBe('blocked');
  });

  it('全部生图失败：run 记为 failed，失败结果不入相册', async () => {
    generateMock.mockImplementation(async (req) => ({
      historyId: req.jobId ?? 'h',
      status: 'failed',
      error: { code: 'PROVIDER_ERROR', message: 'boom' },
    }));

    const result = await runDesignScheme(runRequest(), deps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.generations.every((item) => item.assetId === undefined)).toBe(true);
    expect(new DesignSchemeRepository(db).hasSuccessfulTrial('dsrv_rs')).toBe(false);
    const runRow = db.prepare('SELECT status FROM design_scheme_runs WHERE run_id = ?').get(result.data.runId) as { status: string };
    expect(runRow.status).toBe('failed');
  });

  it('中途取消：剩余任务直接记 cancelled，不再调用生图', async () => {
    generateMock.mockImplementationOnce(async (req) => {
      controller.abort();
      return successResult(req.jobId ?? 'h');
    });

    const result = await runDesignScheme(runRequest(), deps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(result.data.generations[0]?.result.status).toBe('success');
    expect(result.data.generations[1]?.result.status).toBe('cancelled');
  });

  it('正式模式：草稿方案被拒绝', async () => {
    const result = await runDesignScheme(runRequest({ mode: 'formal' }), deps());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('草稿方案不能直接使用');
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('user_first 优先级：快照记录模式，用户要求在提示词最前', async () => {
    generateMock.mockImplementation(async (req) => successResult(req.jobId ?? 'h'));
    const result = await runDesignScheme(
      runRequest({ priorityMode: 'user_first', brief: '改成夜景', generation: { ...runRequest().generation, jobIds: ['job-a'] } }),
      deps(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.compiledPrompt.startsWith('用户本次要求（优先')).toBe(true);
    const runRow = db.prepare('SELECT policy_json FROM design_scheme_runs WHERE run_id = ?').get(result.data.runId) as { policy_json: string };
    expect(JSON.parse(runRow.policy_json).priorityMode).toBe('user_first');
  });

  it('正式模式：转正后的方案可以运行，成功结果不写草稿相册', async () => {
    const repository = new DesignSchemeRepository(db);
    repository.insertRun({ runId: 'dsr_seed', revisionId: 'dsrv_rs', mode: 'trial', policy: {} });
    repository.updateRunStatus('dsr_seed', 'completed');
    const assetId = repository.insertLocalRunAsset('dsrv_rs', '/tmp/seed.png');
    repository.selectCover('dsch_rs', assetId);
    repository.formalize('dsch_rs');

    generateMock.mockImplementation(async (req) => successResult(req.jobId ?? 'h'));

    const result = await runDesignScheme(runRequest({ mode: 'formal', generation: { ...runRequest().generation, jobIds: ['job-f'] } }), deps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.generations[0]?.assetId).toBeUndefined();
    const runRow = db.prepare('SELECT mode, status FROM design_scheme_runs WHERE run_id = ?').get(result.data.runId) as { mode: string; status: string };
    expect(runRow).toEqual({ mode: 'formal', status: 'completed' });
  });
});
