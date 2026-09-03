import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { prepareDesignSchemeRunInputSchema } from '@musefold/contracts';
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import { runDesignSchemeDbMigrations } from '@musefold/core/db/design-scheme/migrations';
import { DesignSchemeRepository } from '@musefold/core/db/design-scheme/repositories';
import { BridgeError } from '../../ipc-v25/envelope';
import {
  assertDesktopPreparedRunAuthority,
  prepareDesktopDesignSchemeRun,
} from '../fixed-run-plan-builder';
import { validateDesktopFixedRunPlan } from '../fixed-run-plan';

const HASH = 'a'.repeat(64);

function document(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1 as const,
    revisionId: 'rev_prepare',
    schemeId: 'scheme_prepare',
    name: 'Prepared scheme',
    summary: 'Prepared scheme summary',
    fidelity: 'faithful' as const,
    sources: [
      {
        id: 'source_prepare',
        kind: 'github-skill' as const,
        role: 'normative' as const,
        snapshotId: 'snapshot_prepare',
      },
    ],
    sourceSnapshotIds: ['snapshot_prepare'],
    inputs: [{ id: 'topic', label: 'Topic', kind: 'text' as const, required: true }],
    parameters: [],
    constraints: [],
    promptProgram: [
      {
        id: 'module_prepare',
        order: 0,
        kind: 'input-template' as const,
        template: 'Create {{topic}}',
        variables: ['topic'],
        sourceIds: ['source_prepare'],
      },
    ],
    compilation: {
      compiledAt: 1,
      model: { model: 'compiler-model' },
      adopted: [],
      omitted: [],
      warnings: [],
      trace: [],
    },
    ...overrides,
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return prepareDesignSchemeRunInputSchema.parse({
    executionId: 'exec_prepare',
    schemeId: 'scheme_prepare',
    revisionId: 'rev_prepare',
    mode: 'trial',
    brief: 'Use a quiet layout',
    inputValues: { topic: 'night market' },
    executionSettings: {
      providerId: 'provider_prepare',
      size: '1024x1024',
      aspectRatio: '1:1',
      quality: 'high',
      outputCount: 1,
      referenceAssetIds: [],
      promptReferenceSelections: [],
    },
    ...overrides,
  });
}

function errorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(BridgeError);
    return (error as BridgeError).code;
  }
  throw new Error('Expected prepare run to fail');
}

describe('desktop fixed design-scheme run plan builder', () => {
  let schemeDb: Database.Database;
  let coreDb: Database.Database;
  let repository: DesignSchemeRepository;

  beforeEach(() => {
    schemeDb = new Database(':memory:');
    runDesignSchemeDbMigrations(schemeDb);
    repository = new DesignSchemeRepository(schemeDb);
    repository.saveSourceSnapshot({
      package: {
        id: 'package_prepare',
        kind: 'github',
        repositoryUrl: 'https://github.com/acme/prepare',
        license: 'MIT',
      },
      snapshot: {
        id: 'snapshot_prepare',
        ref: 'main',
        commitHash: 'b'.repeat(40),
        contentHash: HASH,
        totalBytes: 12,
        scan: {},
      },
      files: [
        {
          path: 'SKILL.md',
          kind: 'text',
          contentHash: HASH,
          sizeBytes: 12,
          mimeType: 'text/markdown',
          textContent: '# prepare',
        },
      ],
    });
    repository.insertSchemeDraft({
      document: document(),
      sourceLabel: 'acme/prepare',
      sourcePresentation: 'skill',
      createdBy: 'user',
      bindings: [{ snapshotId: 'snapshot_prepare', role: 'normative' }],
    });
    coreDb = new Database(':memory:');
    takeoverDesktopDatabase(coreDb);
    coreDb
      .prepare(
        `INSERT INTO providers (id, name, type, base_url, model, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'provider_prepare',
        'Prepared Provider',
        'openai-compatible',
        'https://provider.test/v1',
        'image-model',
        1,
        1,
      );
  });

  it('freezes exact revision, sources, provider and the four-step text-only plan', () => {
    let sequence = 0;
    const prepared = prepareDesktopDesignSchemeRun(input(), {
      designSchemeDb: schemeDb,
      coreDb,
      now: () => 1_788_192_000_000,
      createId: () => `id_${++sequence}`,
    });

    expect(prepared).toMatchObject({
      executionId: 'exec_prepare',
      schemeStatus: 'draft',
      schemeFidelity: 'faithful',
      inputValues: { topic: 'night market' },
      plan: {
        id: 'plan_id_5',
        schemeRevisionId: 'rev_prepare',
        sourceSnapshotIds: ['snapshot_prepare'],
        inputs: [{ slotId: 'topic', kind: 'text', valueIds: [], text: 'night market' }],
        provider: {
          providerId: 'provider_prepare',
          providerName: 'Prepared Provider',
          model: 'image-model',
          capabilities: { image: true, multiImage: true, editing: true },
        },
        policy: { policyVersion: 'desktop-fixed-v1', appliedAt: 1_788_192_000_000 },
        budget: { maxSteps: 4, maxOutputs: 1, maxRepairRuns: 1 },
        evaluation: {
          ratio: '1:1',
          requiredChecks: ['output-count', 'file-valid', 'aspect-ratio'],
        },
      },
    });
    expect(prepared.plan.steps.map((step) => step.kind)).toEqual([
      'inspect-input',
      'compile-prompt',
      'generate-image',
      'evaluate-image',
    ]);
    expect(validateDesktopFixedRunPlan(prepared)).toEqual({ ok: true });
    expect(JSON.stringify(prepared)).not.toMatch(/base_url|provider\.test|apiKey|storeKey|path/);
    expect(() =>
      assertDesktopPreparedRunAuthority(prepared, {
        designSchemeDb: schemeDb,
        coreDb,
      }),
    ).not.toThrow();
  });

  it.each([
    ['missing required input', { inputValues: {} }, 'DESIGN_SCHEME_INPUT_REQUIRED'],
    [
      'unknown input slot',
      { inputValues: { topic: 'night market', forged: 'value' } },
      'DESIGN_SCHEME_INPUT_MISMATCH',
    ],
    [
      'renderer reference asset',
      {
        executionSettings: {
          providerId: 'provider_prepare',
          size: '1024x1024',
          quality: 'high',
          outputCount: 1,
          referenceAssetIds: ['asset_forged'],
          promptReferenceSelections: [],
        },
      },
      'DESIGN_SCHEME_TEXT_ONLY_UNSUPPORTED',
    ],
    ['wrong scheme revision', { revisionId: 'rev_missing' }, 'NOT_FOUND'],
    [
      'missing provider',
      {
        executionSettings: {
          providerId: 'provider_missing',
          size: '1024x1024',
          quality: 'high',
          outputCount: 1,
          referenceAssetIds: [],
          promptReferenceSelections: [],
        },
      },
      'DESIGN_SCHEME_PROVIDER_MISSING',
    ],
  ])('fails closed for %s', (_name, overrides, code) => {
    expect(
      errorCode(() =>
        prepareDesktopDesignSchemeRun(input(overrides as Record<string, unknown>), {
          designSchemeDb: schemeDb,
          coreDb,
        }),
      ),
    ).toBe(code);
  });

  it('rejects image slots and unsupported provider types without guessing capability', () => {
    repository.insertSchemeDraft({
      document: document({
        schemeId: 'scheme_image',
        revisionId: 'rev_image',
        inputs: [
          {
            id: 'reference',
            label: 'Reference',
            kind: 'image',
            required: false,
            imageRole: 'subject-reference',
          },
        ],
      }),
      sourceLabel: 'image',
      sourcePresentation: 'musefold-created',
      createdBy: 'user',
      bindings: [{ snapshotId: 'snapshot_prepare', role: 'normative' }],
    });
    expect(
      errorCode(() =>
        prepareDesktopDesignSchemeRun(
          input({ schemeId: 'scheme_image', revisionId: 'rev_image', inputValues: {} }),
          { designSchemeDb: schemeDb, coreDb },
        ),
      ),
    ).toBe('DESIGN_SCHEME_TEXT_ONLY_UNSUPPORTED');

    coreDb
      .prepare("UPDATE providers SET type = 'future-provider' WHERE id = ?")
      .run('provider_prepare');
    expect(
      errorCode(() => prepareDesktopDesignSchemeRun(input(), { designSchemeDb: schemeDb, coreDb })),
    ).toBe('DESIGN_SCHEME_PROVIDER_UNSUPPORTED');
  });

  it('rejects formal runs for drafts and non-current revisions', () => {
    expect(
      errorCode(() =>
        prepareDesktopDesignSchemeRun(input({ mode: 'formal' }), {
          designSchemeDb: schemeDb,
          coreDb,
        }),
      ),
    ).toBe('DESIGN_SCHEME_FORMAL_REQUIRED');

    repository.applyAgentRevision(
      'scheme_prepare',
      'rev_prepare',
      document({ revisionId: 'rev_prepare_next' }),
    );
    schemeDb
      .prepare("UPDATE design_schemes SET status = 'formal' WHERE id = ?")
      .run('scheme_prepare');
    expect(
      errorCode(() =>
        prepareDesktopDesignSchemeRun(input({ mode: 'formal' }), {
          designSchemeDb: schemeDb,
          coreDb,
        }),
      ),
    ).toBe('DESIGN_SCHEME_REVISION_MISMATCH');
  });

  it('rejects unsupported fidelity and divergent source bindings', () => {
    repository.insertSchemeDraft({
      document: document({
        schemeId: 'scheme_unsupported',
        revisionId: 'rev_unsupported',
        fidelity: 'unsupported',
      }),
      sourceLabel: 'unsupported',
      sourcePresentation: 'musefold-created',
      createdBy: 'user',
      bindings: [{ snapshotId: 'snapshot_prepare', role: 'normative' }],
    });
    expect(
      errorCode(() =>
        prepareDesktopDesignSchemeRun(
          input({ schemeId: 'scheme_unsupported', revisionId: 'rev_unsupported' }),
          { designSchemeDb: schemeDb, coreDb },
        ),
      ),
    ).toBe('DESIGN_SCHEME_RUN_UNSUPPORTED');

    schemeDb
      .prepare(
        'DELETE FROM design_scheme_source_bindings WHERE revision_id = ? AND source_snapshot_id = ?',
      )
      .run('rev_prepare', 'snapshot_prepare');
    expect(
      errorCode(() =>
        prepareDesktopDesignSchemeRun(input(), {
          designSchemeDb: schemeDb,
          coreDb,
        }),
      ),
    ).toBe('DESIGN_SCHEME_SOURCE_SNAPSHOT_INVALID');
  });

  it('normalizes legacy revisions without declared source snapshot ids from bindings', () => {
    const stored = schemeDb
      .prepare('SELECT document_json FROM design_scheme_revisions WHERE revision_id = ?')
      .get('rev_prepare') as { document_json: string };
    const legacyDocument = JSON.parse(stored.document_json) as Record<string, unknown>;
    delete legacyDocument.sourceSnapshotIds;
    schemeDb
      .prepare('UPDATE design_scheme_revisions SET document_json = ? WHERE revision_id = ?')
      .run(JSON.stringify(legacyDocument), 'rev_prepare');

    const prepared = prepareDesktopDesignSchemeRun(input(), {
      designSchemeDb: schemeDb,
      coreDb,
    });

    expect(prepared.plan.sourceSnapshotIds).toEqual(['snapshot_prepare']);
  });

  it('rejects a prepared plan after authoritative provider or source data changes', () => {
    const prepared = prepareDesktopDesignSchemeRun(input(), {
      designSchemeDb: schemeDb,
      coreDb,
    });
    prepared.plan.inputs.push({
      slotId: 'forged_slot',
      kind: 'image',
      valueIds: [],
      text: null,
    });
    expect(
      errorCode(() =>
        assertDesktopPreparedRunAuthority(prepared, {
          designSchemeDb: schemeDb,
          coreDb,
        }),
      ),
    ).toBe('DESIGN_SCHEME_RUN_SNAPSHOT_MISMATCH');

    prepared.plan.inputs.pop();
    prepared.plan.inputs.pop();
    expect(
      errorCode(() =>
        assertDesktopPreparedRunAuthority(prepared, {
          designSchemeDb: schemeDb,
          coreDb,
        }),
      ),
    ).toBe('DESIGN_SCHEME_RUN_SNAPSHOT_MISMATCH');

    prepared.plan.inputs.push({
      slotId: 'topic',
      kind: 'text',
      valueIds: [],
      text: 'night market',
    });
    coreDb
      .prepare('UPDATE providers SET model = ? WHERE id = ?')
      .run('new-model', 'provider_prepare');
    expect(
      errorCode(() =>
        assertDesktopPreparedRunAuthority(prepared, {
          designSchemeDb: schemeDb,
          coreDb,
        }),
      ),
    ).toBe('DESIGN_SCHEME_RUN_SNAPSHOT_MISMATCH');
  });
});
