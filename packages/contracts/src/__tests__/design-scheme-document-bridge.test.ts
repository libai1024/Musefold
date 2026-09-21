import { expect, it } from 'vitest';
import {
  designSchemeRevisionDocumentSchema,
  legacyDesignSchemeRevisionDocumentSchema,
  canonicalDesignSchemeDocumentToLegacy,
  legacyDesignSchemeDocumentToCanonical,
} from '../index';
const document = () =>
  designSchemeRevisionDocumentSchema.parse({
    schemaVersion: 1,
    revisionId: 'rev',
    schemeId: 'scheme',
    name: '旧格式兼容',
    summary: '',
    fidelity: 'adapted',
    createdBy: 'import',
    createdAt: 10,
    parentRevisionId: 'parent',
    sources: [],
    inputs: [],
    parameters: [],
    constraints: [
      {
        id: 'rule',
        domain: 'color',
        statement: 'Blue',
        mode: 'preferred',
        sourceIds: [],
        evidencePath: 'SKILL.md',
        userOverridable: true,
      },
    ],
    promptProgram: [
      {
        id: 'prompt',
        order: 0,
        kind: 'input-template',
        template: 'Draw',
        variables: [],
        sourceIds: [],
      },
    ],
    compilation: {
      compiledAt: 1,
      compilerVersion: 'v2',
      model: { model: 'fixture' },
      adopted: [],
      omitted: [],
      warnings: [],
      trace: [
        {
          id: 'trace',
          kind: 'assistant',
          status: 'running',
          title: '历史记录',
          output: '完整保留',
        },
      ],
    },
  });
it('canonical → legacy JSON parse → canonical preserves lineage, evidence and compilation facts', () => {
  const value = document();
  const stored = legacyDesignSchemeRevisionDocumentSchema.parse(
    JSON.parse(JSON.stringify(canonicalDesignSchemeDocumentToLegacy(value))),
  );
  expect(legacyDesignSchemeDocumentToCanonical(stored)).toEqual(value);
});
it('older documents without lineage remain readable without inventing a parent', () => {
  const { createdBy, createdAt, parentRevisionId, ...old } = canonicalDesignSchemeDocumentToLegacy(
    document(),
  );
  const result = legacyDesignSchemeDocumentToCanonical(
    legacyDesignSchemeRevisionDocumentSchema.parse(old),
  );
  expect(result.createdBy).toBe('agent');
  expect(result.parentRevisionId).toBeUndefined();
  expect(result.createdAt).toBeUndefined();
});
it('legacy local source locators are omitted while fixed identities and safe metadata survive', () => {
  const value = canonicalDesignSchemeDocumentToLegacy(document());
  value.sources = [
    {
      id: 'src',
      kind: 'history-image',
      role: 'example',
      uri: 'history:old-run',
      snapshotId: 'snap',
      packageId: 'pkg',
    },
  ];
  const result = legacyDesignSchemeDocumentToCanonical(value);
  expect(result.sources[0]).toMatchObject({ snapshotId: 'snap', packageId: 'pkg' });
  expect(result.sources[0].uri).toBeUndefined();
});
