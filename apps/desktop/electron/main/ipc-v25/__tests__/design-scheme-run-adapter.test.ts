import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  designSchemeEventSchema,
  designSchemeRunInputSchema,
  runResultSchema,
  type ParsedDesignSchemeRunInput,
} from '@musefold/contracts';
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import { runDesignSchemeDbMigrations } from '@musefold/core/db/design-scheme/migrations';
import { DesignSchemeRepository } from '@musefold/core/db/design-scheme/repositories';
import { ensureAccountWorkspace } from '@musefold/core/db/workspaces';
import { fakePngBuffer } from '../../design-scheme/__tests__/evaluation.test';
import { DesignSchemeExecutionRegistry } from '../../design-scheme/execution-registry';
import { DESIGN_SCHEME_DOCUMENT_VERSION } from '@musefold/desktop-contracts/design-scheme/schema';
import type { DesignSchemeRevisionDocument } from '@musefold/desktop-contracts/design-scheme/schema';

const runDesignSchemeMock = vi.hoisted(() => vi.fn());
const cancelGenerationMock = vi.hoisted(() => vi.fn());
vi.mock('../../design-scheme/run-session', async () => {
  const actual = await vi.importActual<typeof import('../../design-scheme/run-session')>(
    '../../design-scheme/run-session',
  );
  return { ...actual, runDesignScheme: runDesignSchemeMock };
});
vi.mock('../../generation-facade', () => ({ cancelGeneration: cancelGenerationMock }));
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }));

import { runCanonicalDesignScheme } from '../design-scheme-run-adapter';

function documentFixture(): DesignSchemeRevisionDocument {
  return {
    schemaVersion: DESIGN_SCHEME_DOCUMENT_VERSION,
    revisionId: 'rev_adapter',
    schemeId: 'scheme_adapter',
    name: 'Adapter scheme',
    summary: 'Adapter test scheme',
    fidelity: 'adapted',
    sources: [{ id: 'source_brief', kind: 'user-brief', role: 'context' }],
    inputs: [{ id: 'topic', label: 'Topic', kind: 'text', required: true }],
    parameters: [],
    constraints: [],
    promptProgram: [
      {
        id: 'module_1',
        order: 0,
        kind: 'input-template',
        template: 'Create {{topic}}',
        variables: ['topic'],
        sourceIds: ['source_brief'],
      },
    ],
    compilation: {
      compiledAt: 1,
      model: { model: 'fixture', connectionName: 'fixture' },
      adopted: [],
      omitted: [],
      warnings: [],
      trace: [],
    },
  };
}

function step(
  id: string,
  kind: 'inspect-input' | 'compile-prompt' | 'generate-image' | 'evaluate-image',
  dependsOn: string[],
) {
  return {
    id,
    kind,
    dependsOn,
    inputRefs: [],
    outputRefs: [],
    timeoutMs: 30_000,
    maxAttempts: 1,
    status: 'pending' as const,
    startedAt: null,
    completedAt: null,
    error: null,
  };
}

function inputFixture(overrides: Record<string, unknown> = {}): ParsedDesignSchemeRunInput {
  return designSchemeRunInputSchema.parse({
    executionId: 'exec_adapter',
    schemeId: 'scheme_adapter',
    revisionId: 'rev_adapter',
    schemeStatus: 'draft',
    schemeFidelity: 'adapted',
    mode: 'trial',
    priorityMode: 'scheme_first',
    brief: 'A market poster',
    inputValues: { topic: 'night market' },
    executionSettings: {
      providerId: 'provider_adapter',
      size: '1024x1024',
      aspectRatio: '1:1',
      quality: 'high',
      outputCount: 1,
      referenceAssetIds: [],
      promptReferenceSelections: [
        { promptId: 'prompt_adapter', scope: 'full', expectedVersion: 1 },
      ],
      workbenchSessionId: 'session_adapter',
    },
    plan: {
      id: 'plan_adapter',
      schemaVersion: 1,
      schemeRevisionId: 'rev_adapter',
      sourceSnapshotIds: ['snapshot_adapter'],
      inputs: [{ slotId: 'topic', kind: 'text', valueIds: [], text: 'night market' }],
      steps: [
        step('step_inspect', 'inspect-input', []),
        step('step_compile', 'compile-prompt', ['step_inspect']),
        step('step_generate', 'generate-image', ['step_compile']),
        step('step_evaluate', 'evaluate-image', ['step_generate']),
      ],
      provider: {
        providerId: 'provider_adapter',
        providerName: 'Adapter Provider',
        model: 'adapter-model',
        providerVersion: null,
        capabilities: { text: true, vision: true, image: true, multiImage: true, editing: true },
      },
      policy: {
        priorityMode: 'scheme_first',
        schemeRevisionId: 'rev_adapter',
        policyVersion: 'desktop-fixed-v1',
        appliedAt: 1,
      },
      budget: { maxSteps: 4, maxOutputs: 1, maxRepairRuns: 1 },
      evaluation: { ratio: '1:1', requiredChecks: ['output-count', 'file-valid', 'aspect-ratio'] },
    },
    repair: null,
    ...overrides,
  });
}

function seedCoreDb(db: Database.Database): void {
  db.pragma('foreign_keys = ON');
  takeoverDesktopDatabase(db);
  db.prepare(
    `INSERT INTO providers (id, name, type, base_url, model, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'provider_adapter',
    'Adapter Provider',
    'openai-compatible',
    'https://example.test',
    'adapter-model',
    1,
    1,
  );
  db.prepare(
    `INSERT INTO cloud_sync_accounts
       (owner_id, username, device_id, device_name, platform, client_version, active, enabled,
        cursor, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'macos', 'test', 1, 1, '0', ?, ?)`,
  ).run('owner_adapter', 'owner_adapter', 'device_adapter', 'Adapter device', 1, 1);
  const workspaceId = ensureAccountWorkspace(db, 'owner_adapter', 1);
  db.prepare(
    `INSERT INTO prompts (id, workspace_id, title, content, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('prompt_adapter', workspaceId, 'Core prompt', 'Core prompt content', 1, 1);
  db.prepare(
    `INSERT INTO workbench_sessions (id, title, created_at, updated_at, archived_at, deleted_at)
     VALUES (?, ?, ?, ?, NULL, NULL)`,
  ).run('session_adapter', 'Core session', 1, 1);
  db.prepare(
    `INSERT INTO generation_runs
      (id, run_kind, workbench_session_id, workbench_turn_id, turn_index, result_index,
       parent_run_id, retry_of_run_id, source_asset_id, provider_id, model, user_prompt,
       base_prompt, refinement_instruction, final_prompt, negative_prompt, params_json,
       prompt_snapshot_json, status, error_code, error_message, request_id, estimated_cost,
       actual_cost, duration_ms, created_at, started_at, finished_at, deleted_at)
     VALUES (?, 'free_generation', ?, ?, 2, 0, NULL, NULL, NULL, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, 'success', NULL, NULL, NULL, NULL, NULL, NULL, 1, 1, 1, NULL)`,
  ).run(
    'prior_run_adapter',
    'session_adapter',
    'prior_turn',
    'provider_adapter',
    'adapter-model',
    'old prompt',
    'old prompt',
    'old prompt',
    '{}',
    '{}',
  );
}

describe('desktop design-scheme run adapter', () => {
  let schemeDb: Database.Database;
  let coreDb: Database.Database;
  let root: string;
  let events: unknown[];
  let registry: DesignSchemeExecutionRegistry;

  beforeEach(() => {
    runDesignSchemeMock.mockReset();
    cancelGenerationMock.mockReset();
    schemeDb = new Database(':memory:');
    runDesignSchemeDbMigrations(schemeDb);
    runDesignSchemeMock.mockImplementation(
      async (request: { runId?: string; revisionId: string; mode: 'trial' | 'formal' }) => {
        new DesignSchemeRepository(schemeDb).insertRun({
          runId: request.runId ?? 'dsr_mock',
          revisionId: request.revisionId,
          mode: request.mode,
          policy: {},
        });
        return {
          ok: true,
          data: { compiledPrompt: 'compiled prompt', generations: [], evaluation: undefined },
        };
      },
    );
    new DesignSchemeRepository(schemeDb).insertSchemeDraft({
      document: documentFixture(),
      sourceLabel: 'Musefold created',
      sourcePresentation: 'musefold-created',
      createdBy: 'user',
      bindings: [],
    });
    coreDb = new Database(':memory:');
    seedCoreDb(coreDb);
    root = mkdtempSync(join(tmpdir(), 'musefold-adapter-'));
    events = [];
    registry = new DesignSchemeExecutionRegistry();
  });

  afterEach(() => {
    schemeDb.close();
    coreDb.close();
    rmSync(root, { recursive: true, force: true });
  });

  function mockRetainedRun(data: unknown): void {
    runDesignSchemeMock.mockImplementationOnce(
      async (request: { runId?: string; revisionId: string; mode: 'trial' | 'formal' }) => {
        new DesignSchemeRepository(schemeDb).insertRun({
          runId: request.runId ?? 'dsr_mock',
          revisionId: request.revisionId,
          mode: request.mode,
          policy: {},
        });
        return { ok: true, data };
      },
    );
  }

  function mockRetainedFailure(error: { code: string; message: string }): void {
    runDesignSchemeMock.mockImplementationOnce(
      async (request: { runId?: string; revisionId: string; mode: 'trial' | 'formal' }) => {
        new DesignSchemeRepository(schemeDb).insertRun({
          runId: request.runId ?? 'dsr_mock',
          revisionId: request.revisionId,
          mode: request.mode,
          policy: {},
        });
        return { ok: false, error };
      },
    );
  }

  function runStatus(runId: string): string {
    return (
      schemeDb.prepare('SELECT status FROM design_scheme_runs WHERE run_id = ?').get(runId) as {
        status: string;
      }
    ).status;
  }

  it('uses the scheme and core databases for their respective responsibilities', async () => {
    const result = await runCanonicalDesignScheme(inputFixture(), 71, {
      db: schemeDb,
      coreDb,
      userDataDir: root,
      picturesDir: join(root, 'Pictures'),
      executionRegistry: registry,
      emit: (_senderId, event) => events.push(event),
    });

    expect(runDesignSchemeMock).toHaveBeenCalledTimes(1);
    const request = runDesignSchemeMock.mock.calls[0]?.[0];
    expect(request.generation.requestTemplate).toMatchObject({
      providerId: 'provider_adapter',
      model: 'adapter-model',
    });
    expect(request.generation.requestTemplate.promptReferences).toEqual([
      {
        promptId: 'prompt_adapter',
        title: 'Core prompt',
        text: 'Core prompt content',
        scope: 'full',
        sourceVersion: 1,
      },
    ]);
    expect(request.generation.requestTemplate.workbench).toMatchObject({
      sessionId: 'session_adapter',
      sessionTitle: 'Core session',
      turnIndex: 3,
    });
    expect(runResultSchema.safeParse(result).success).toBe(true);
    expect(events.every((event) => designSchemeEventSchema.safeParse(event).success)).toBe(true);
    expect(registry.get(71, 'exec_adapter').status).toBe('already-terminal');
  });

  it('commits a canonical success before emitting completed', async () => {
    const imagePath = join(root, 'completed.png');
    writeFileSync(imagePath, fakePngBuffer(1024, 1024));
    let statusAtCompletedEvent: string | null = null;
    mockRetainedRun({
      runId: 'ignored-by-adapter',
      compiledPrompt: 'compiled prompt',
      generations: [
        {
          jobId: 'job_completed',
          resultIndex: 0,
          assetId: 'asset_completed',
          result: { historyId: 'job_completed', status: 'success', imagePath },
        },
      ],
      trace: [],
      evaluation: {
        evaluationId: 'evaluation_completed',
        runId: 'ignored-by-adapter',
        passed: true,
        checks: [
          { id: 'output-count', label: 'Output count', status: 'pass' },
          { id: 'file-valid', label: 'File valid', status: 'pass' },
          { id: 'aspect-ratio', label: 'Aspect ratio', status: 'pass' },
        ],
        repairHint: null,
        createdAt: 1,
      },
    });

    const result = await runCanonicalDesignScheme(
      inputFixture({ executionId: 'exec_completed' }),
      74,
      {
        db: schemeDb,
        coreDb,
        userDataDir: root,
        picturesDir: join(root, 'Pictures'),
        executionRegistry: registry,
        emit: (_senderId, event) => {
          events.push(event);
          if (event.kind === 'completed') statusAtCompletedEvent = runStatus(event.result.runId);
        },
      },
    );

    expect(result.status).toBe('completed');
    expect(runStatus(result.runId)).toBe('completed');
    expect(statusAtCompletedEvent).toBe('completed');
    expect(new DesignSchemeRepository(schemeDb).hasSuccessfulTrial('rev_adapter')).toBe(true);
  });

  it('preserves blocked status in the scheme run ledger', async () => {
    mockRetainedFailure({ code: 'REQUIRED', message: 'Topic is required' });

    const result = await runCanonicalDesignScheme(
      inputFixture({ executionId: 'exec_blocked' }),
      75,
      {
        db: schemeDb,
        coreDb,
        userDataDir: root,
        picturesDir: join(root, 'Pictures'),
        executionRegistry: registry,
        emit: (_senderId, event) => events.push(event),
      },
    );

    expect(result.status).toBe('blocked');
    expect(runStatus(result.runId)).toBe('blocked');
    expect(events.at(-1)).toMatchObject({ kind: 'blocked', runId: result.runId });
    expect(new DesignSchemeRepository(schemeDb).hasSuccessfulTrial('rev_adapter')).toBe(false);
  });

  it('marks the scheme run failed when a retained output is missing or corrupt', async () => {
    const corruptPath = join(root, 'corrupt.png');
    writeFileSync(corruptPath, Buffer.from('not-an-image'));
    mockRetainedRun({
      runId: 'ignored-by-adapter',
      compiledPrompt: 'compiled prompt',
      generations: [
        {
          jobId: 'job_corrupt',
          resultIndex: 0,
          assetId: 'asset_corrupt',
          result: { historyId: 'job_corrupt', status: 'success', imagePath: corruptPath },
        },
      ],
      trace: [],
    });

    const result = await runCanonicalDesignScheme(
      inputFixture({ executionId: 'exec_corrupt' }),
      76,
      {
        db: schemeDb,
        coreDb,
        userDataDir: root,
        picturesDir: join(root, 'Pictures'),
        executionRegistry: registry,
        emit: (_senderId, event) => events.push(event),
      },
    );

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('DESIGN_SCHEME_OUTPUT_UNMAPPABLE');
    expect(runStatus(result.runId)).toBe('failed');
    expect(new DesignSchemeRepository(schemeDb).hasSuccessfulTrial('rev_adapter')).toBe(false);
  });

  it('marks the scheme run failed before emitting an invalid canonical result', async () => {
    mockRetainedRun({
      runId: 'ignored-by-adapter',
      compiledPrompt: 'x'.repeat(12_001),
      generations: [],
      trace: [],
    });

    const result = await runCanonicalDesignScheme(
      inputFixture({ executionId: 'exec_schema' }),
      77,
      {
        db: schemeDb,
        coreDb,
        userDataDir: root,
        picturesDir: join(root, 'Pictures'),
        executionRegistry: registry,
        emit: (_senderId, event) => events.push(event),
      },
    );

    expect(result.status).toBe('failed');
    expect(runStatus(result.runId)).toBe('failed');
    expect(events.some((event) => (event as { kind?: string }).kind === 'completed')).toBe(false);
    expect(events.every((event) => designSchemeEventSchema.safeParse(event).success)).toBe(true);
  });

  it('returns a canonical provider snapshot mismatch and closes the execution', async () => {
    const input = inputFixture({
      plan: {
        ...inputFixture().plan,
        provider: { ...inputFixture().plan.provider, providerName: 'Changed provider' },
      },
    });
    const result = await runCanonicalDesignScheme(input, 72, {
      db: schemeDb,
      coreDb,
      userDataDir: root,
      picturesDir: join(root, 'Pictures'),
      executionRegistry: registry,
      emit: (_senderId, event) => events.push(event),
    });
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('DESIGN_SCHEME_PROVIDER_SNAPSHOT_MISMATCH');
    expect(runDesignSchemeMock).not.toHaveBeenCalled();
    expect(registry.get(72, 'exec_adapter')).toMatchObject({
      status: 'already-terminal',
      execution: { terminalStatus: 'failed' },
    });
  });

  it('removes staged references when preparation fails after staging', async () => {
    const staged = join(root, 'staged.png');
    mkdirSync(join(root, 'Pictures'), { recursive: true });
    writeFileSync(join(root, 'Pictures', 'source.png'), Buffer.from('source'));
    const repository = new DesignSchemeRepository(schemeDb);
    const assetId = repository.insertLocalRunAsset(
      'rev_adapter',
      join(root, 'Pictures', 'source.png'),
    );
    const input = inputFixture({
      executionSettings: {
        ...inputFixture().executionSettings,
        referenceAssetIds: [assetId],
        workbenchSessionId: 'missing_session',
      },
      plan: {
        ...inputFixture().plan,
        inputs: [
          { slotId: 'topic', kind: 'text', valueIds: [], text: 'night market' },
          { slotId: 'reference', kind: 'image', valueIds: [assetId], text: null },
        ],
      },
    });
    const result = await runCanonicalDesignScheme(input, 73, {
      db: schemeDb,
      coreDb,
      userDataDir: root,
      picturesDir: join(root, 'Pictures'),
      executionRegistry: registry,
      stageReferenceAsset: async () => {
        writeFileSync(staged, Buffer.from('staged'));
        return { path: staged, source: 'upload' };
      },
      emit: (_senderId, event) => events.push(event),
    });
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('NOT_FOUND');
    expect(existsSync(staged)).toBe(false);
    expect(runDesignSchemeMock).not.toHaveBeenCalled();
    expect(registry.get(73, 'exec_adapter')).toMatchObject({
      status: 'already-terminal',
      execution: { terminalStatus: 'failed' },
    });
  });
});
