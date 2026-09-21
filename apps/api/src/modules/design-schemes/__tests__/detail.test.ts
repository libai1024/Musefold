import { OpenAPIHono } from '@hono/zod-openapi';
import {
  DESIGN_SCHEME_DOCUMENT_VERSION,
  designSchemePageSchema,
  type DesignSchemeRevisionDocument,
} from '@musefold/contracts';
import { type MusefoldDatabase, createDatabase, migrateDatabase } from '@musefold/db';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthedEnv } from '../../../auth/middleware.js';
import { AppError, toErrorBody } from '../../../lib/errors.js';
import { designSchemeRoutes } from '../routes.js';
import { DesignSchemeService } from '../service.js';

const OWNER_ID = 'design-scheme-detail-owner';
const OTHER_OWNER_ID = 'design-scheme-detail-other-owner';
const runDatabaseTests = process.env.RUN_DATABASE_TESTS === 'true';
const describeDb = runDatabaseTests ? describe : describe.skip;

function document(
  schemeId: string,
  revisionId: string,
  parentRevisionId: string | null = null,
): DesignSchemeRevisionDocument {
  return {
    schemaVersion: DESIGN_SCHEME_DOCUMENT_VERSION,
    revisionId,
    schemeId,
    name: `Scheme ${revisionId}`,
    summary: `Revision ${revisionId}`,
    fidelity: 'faithful',
    sources: [],
    sourceSnapshotIds: [],
    inputs: [{ id: 'subject', label: 'Subject', kind: 'text', required: true }],
    parameters: [],
    constraints: [],
    promptProgram: [
      {
        id: 'prompt_main',
        order: 0,
        kind: 'input-template',
        template: '{{subject}}',
        variables: ['subject'],
        sourceIds: [],
      },
    ],
    assetIds: [],
    compilation: {
      compiledAt: '2026-09-01T00:00:00.000Z',
      model: { model: 'detail-selector-test' },
      adopted: [],
      omitted: [],
      warnings: [],
      trace: [],
    },
    parentRevisionId,
    createdBy: 'user',
    createdAt: '2026-09-01T00:00:00.000Z',
  };
}

function createInput(documentValue: DesignSchemeRevisionDocument) {
  return {
    executionId: `execution_${documentValue.schemeId}`,
    brief: `Create ${documentValue.schemeId}`,
    sourceUris: [],
    sourceBindings: [],
    sourcePackages: [],
    sourceSnapshots: [],
    sourceAssetIds: [],
    sourceAssets: [],
    historySources: [],
    document: documentValue,
  };
}

function testApp(service: DesignSchemeService, userId: string) {
  const app = new OpenAPIHono<AuthedEnv>();
  app.use('*', async (c, next) => {
    c.set('userId', userId);
    c.set('sessionId', 'detail-selector-test-session');
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof AppError) {
      return c.json(toErrorBody(error, 'detail-selector-test-request'), error.status as 400);
    }
    throw error;
  });
  app.route('/', designSchemeRoutes(service));
  return app;
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe('Design Scheme prepare-import route', () => {
  const service = new DesignSchemeService({} as MusefoldDatabase);
  const app = testApp(service, OWNER_ID);

  it('validates the canonical input before returning the structured cloud blocker', async () => {
    const blocked = await app.request('/design-schemes/prepare-import-package', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(blocked.status).toBe(501);
    await expect(responseBody(blocked)).resolves.toMatchObject({
      error: {
        code: 'INTERNAL_ERROR',
        retryable: false,
        details: {
          operation: 'prepareImportPackage',
          designSchemeError: {
            code: 'DESIGN_SCHEME_CLOUD_IMPORT_STAGING_UNAVAILABLE',
            retryable: false,
            recoveryAction: 'none',
          },
        },
      },
    });

    const invalid = await app.request('/design-schemes/prepare-import-package', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ acceptedFormatVersions: [1, 1] }),
    });
    expect(invalid.status).toBe(400);
    await expect(responseBody(invalid)).resolves.toMatchObject({
      error: { code: 'VALIDATION_FAILED' },
    });
  });
});

describeDb('Design Scheme detail revision selector (real PostgreSQL)', () => {
  let container: StartedPostgreSqlContainer;
  let db: MusefoldDatabase;
  let pool: pg.Pool;
  let ownerApp: ReturnType<typeof testApp>;
  let otherOwnerApp: ReturnType<typeof testApp>;

  const schemeId = 'scheme_detail_selector';
  const currentRevisionId = 'revision_detail_current';
  const workingDraftRevisionId = 'revision_detail_working';
  const staleRevisionId = 'revision_detail_stale';
  const foreignSchemeId = 'scheme_detail_foreign';
  const foreignRevisionId = 'revision_detail_foreign';

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    const created = createDatabase(container.getConnectionUri(), { max: 5 });
    db = created.db;
    pool = created.pool;
    await migrateDatabase(db);
    await pool.query('INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3), ($4, $5, $6)', [
      OWNER_ID,
      'Detail owner',
      'design-scheme-detail-owner@musefold.app',
      OTHER_OWNER_ID,
      'Other detail owner',
      'design-scheme-detail-other@musefold.app',
    ]);

    const service = new DesignSchemeService(db);
    await service.create(OWNER_ID, createInput(document(schemeId, currentRevisionId)));
    await service.update(OWNER_ID, {
      schemeId,
      baseRevisionId: currentRevisionId,
      document: document(schemeId, workingDraftRevisionId, currentRevisionId),
      expectedVersion: 1,
    });
    await service.update(OWNER_ID, {
      schemeId,
      baseRevisionId: workingDraftRevisionId,
      document: document(schemeId, staleRevisionId, workingDraftRevisionId),
      expectedVersion: 2,
    });
    await pool.query(
      `UPDATE design_schemes
       SET current_revision_id = $2,
           working_draft_revision_id = $3,
           name = $4,
           summary = $5,
           fidelity = $6
       WHERE id = $1 AND user_id = $7`,
      [
        schemeId,
        currentRevisionId,
        workingDraftRevisionId,
        `Scheme ${currentRevisionId}`,
        `Revision ${currentRevisionId}`,
        'faithful',
        OWNER_ID,
      ],
    );
    await service.create(OTHER_OWNER_ID, createInput(document(foreignSchemeId, foreignRevisionId)));

    ownerApp = testApp(service, OWNER_ID);
    otherOwnerApp = testApp(service, OTHER_OWNER_ID);
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('defaults to current and selects only the exact visible working draft', async () => {
    const defaultDetail = await ownerApp.request(`/design-schemes/${schemeId}`);
    expect(defaultDetail.status).toBe(200);
    await expect(responseBody(defaultDetail)).resolves.toMatchObject({
      summary: {
        id: schemeId,
        currentRevisionId,
        workingDraftRevisionId,
      },
      document: { revisionId: currentRevisionId },
    });

    const explicitCurrent = await ownerApp.request(
      `/design-schemes/${schemeId}?revisionKind=current`,
    );
    expect(explicitCurrent.status).toBe(200);
    await expect(responseBody(explicitCurrent)).resolves.toMatchObject({
      document: { revisionId: currentRevisionId },
    });

    const workingDraft = await ownerApp.request(
      `/design-schemes/${schemeId}?revisionKind=working-draft&revisionId=${workingDraftRevisionId}`,
    );
    expect(workingDraft.status).toBe(200);
    await expect(responseBody(workingDraft)).resolves.toMatchObject({
      document: { revisionId: workingDraftRevisionId },
    });
  });

  it('returns one structured mismatch for current, stale, and foreign revision IDs', async () => {
    const revisionIds = [currentRevisionId, staleRevisionId, foreignRevisionId];
    const errors: Record<string, unknown>[] = [];
    for (const revisionId of revisionIds) {
      const response = await ownerApp.request(
        `/design-schemes/${schemeId}?revisionKind=working-draft&revisionId=${revisionId}`,
      );
      expect(response.status).toBe(409);
      const body = await responseBody(response);
      expect(body).toMatchObject({
        error: {
          code: 'VALIDATION_FAILED',
          retryable: false,
          details: {
            designSchemeCode: 'DESIGN_SCHEME_DETAIL_REVISION_MISMATCH',
            designSchemeError: {
              code: 'DESIGN_SCHEME_DETAIL_REVISION_MISMATCH',
              retryable: false,
              recoveryAction: 'retry',
            },
          },
        },
      });
      errors.push(body);
    }
    expect(errors[1]).toEqual(errors[0]);
    expect(errors[2]).toEqual(errors[0]);
  });

  it('lists all removed schemes with exact microsecond cursors, literal filters and owner isolation', async () => {
    const service = new DesignSchemeService(db);
    for (let index = 0; index < 205; index++) {
      const id = `paging_${String(index).padStart(3, '0')}`;
      await service.create(
        OWNER_ID,
        createInput({ ...document(id, `revision_${id}`), name: `Paging 100%_ ÄBC ${index}` }),
      );
      await pool.query(
        `UPDATE design_schemes SET deleted_at = now(), version = 2,
        updated_at = '2026-09-19T00:00:00.000100Z'::timestamptz + ($2::int * interval '1 microsecond')
        WHERE id = $1`,
        [id, index % 3],
      );
    }
    await service.create(
      OWNER_ID,
      createInput(document('paging_active', 'paging_active_revision')),
    );
    await service.create(
      OTHER_OWNER_ID,
      createInput(document('paging_other', 'paging_other_revision')),
    );
    await pool.query("UPDATE design_schemes SET deleted_at=now() WHERE id='paging_other'");
    const expected = (
      await pool.query(
        `SELECT id FROM design_schemes WHERE user_id=$1
      AND deleted_at IS NOT NULL AND id LIKE 'paging%'
      ORDER BY updated_at DESC, id COLLATE "C" DESC`,
        [OWNER_ID],
      )
    ).rows.map((row) => row.id);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const query = new URLSearchParams({ deletedOnly: 'true', query: 'paging_', limit: '31' });
      if (cursor) query.set('cursor', cursor);
      const response = await ownerApp.request(`/design-schemes?${query}`);
      expect(response.status).toBe(200);
      const page = designSchemePageSchema.parse(await response.json());
      expect(page.items.every((item) => item.version === 2)).toBe(true);
      if (!cursor) {
        expect(page.items).toHaveLength(31);
        if (!page.nextCursor) throw new Error('Expected a second page');
        const payload = JSON.parse(Buffer.from(page.nextCursor, 'base64url').toString());
        expect(payload.updatedAt).toMatch(/\.000102Z$/);
        const wrongScope = await ownerApp.request(
          `/design-schemes?${new URLSearchParams({ cursor: page.nextCursor, deletedOnly: 'false', query: 'paging_' })}`,
        );
        expect(wrongScope.status).toBe(400);
        const literal = await ownerApp.request(
          `/design-schemes?${new URLSearchParams({ deletedOnly: 'true', query: '%_', limit: '100' })}`,
        );
        expect(designSchemePageSchema.parse(await literal.json()).items).toHaveLength(100);
        const noWildcard = await ownerApp.request(
          `/design-schemes?${new URLSearchParams({ deletedOnly: 'true', query: '%__' })}`,
        );
        expect(designSchemePageSchema.parse(await noWildcard.json()).items).toHaveLength(0);
        const unicode = await ownerApp.request(
          `/design-schemes?${new URLSearchParams({ deletedOnly: 'true', query: 'äbc', limit: '100' })}`,
        );
        expect(designSchemePageSchema.parse(await unicode.json()).items).toHaveLength(100);
      }
      seen.push(...page.items.map((item) => item.id));
      // Removing earlier pages must not make offset-style skips on subsequent pages.
      await pool.query('DELETE FROM design_schemes WHERE id=ANY($1::text[]) AND user_id=$2', [
        page.items.map((item) => item.id),
        OWNER_ID,
      ]);
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(expected);
    expect(new Set(seen).size).toBe(205);
    const active = await ownerApp.request('/design-schemes?query=paging_&deletedOnly=false');
    expect(designSchemePageSchema.parse(await active.json()).items.map((item) => item.id)).toEqual([
      'paging_active',
    ]);
    expect((await ownerApp.request('/design-schemes?deletedOnly=yes')).status).toBe(400);
    expect((await ownerApp.request('/design-schemes?cursor=1')).status).toBe(400);
  }, 30_000);

  it('validates selector shape and preserves owner isolation', async () => {
    for (const query of [
      'revisionKind=working-draft',
      `revisionKind=current&revisionId=${currentRevisionId}`,
      'revisionKind=unknown',
      'revisionKind=working-draft&revisionId=%2Ftmp%2Frevision.json',
    ]) {
      const invalid = await ownerApp.request(`/design-schemes/${schemeId}?${query}`);
      expect(invalid.status).toBe(400);
      await expect(responseBody(invalid)).resolves.toMatchObject({
        error: { code: 'VALIDATION_FAILED' },
      });
    }

    const hidden = await otherOwnerApp.request(`/design-schemes/${schemeId}`);
    expect(hidden.status).toBe(404);
    await expect(responseBody(hidden)).resolves.toMatchObject({
      error: {
        code: 'VALIDATION_FAILED',
        details: { designSchemeCode: 'DESIGN_SCHEME_NOT_FOUND' },
      },
    });
  });
});
