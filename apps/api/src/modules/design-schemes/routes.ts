import {
  cancelDesignSchemeInputSchema,
  confirmDesignSchemeInstallInputSchema,
  cancelDesignSchemeResultSchema,
  confirmDesignSchemeInstallResultSchema,
  checkDesignSchemeUpdateInputSchema,
  checkDesignSchemeUpdateResultSchema,
  createDesignSchemeInputSchema,
  createDesignSchemeResultSchema,
  designSchemeDetailInputSchema,
  designSchemeDetailSchema,
  designSchemeListQuerySchema,
  designSchemePageSchema,
  designSchemeRunInputSchema,
  exportDesignSchemeInputSchema,
  exportDesignSchemeResultSchema,
  formalizeDesignSchemeInputSchema,
  formalizeDesignSchemeResultSchema,
  importDesignSchemeInputSchema,
  importDesignSchemeResultSchema,
  marketSearchQuerySchema,
  marketSearchResultSchema,
  modifyDesignSchemeInputSchema,
  modifyDesignSchemeResultSchema,
  opaqueIdSchema,
  prepareDesignSchemeImportPackageInputSchema,
  prepareDesignSchemeImportPackageResultSchema,
  promoteWorkingDraftInputSchema,
  promoteWorkingDraftResultSchema,
  removeDesignSchemeInputSchema,
  removeDesignSchemeResultSchema,
  renameDesignSchemeInputSchema,
  renameDesignSchemeResultSchema,
  runResultSchema,
  selectCoverInputSchema,
  selectCoverResultSchema,
  updateDesignSchemeInputSchema,
  updateDesignSchemeResultSchema,
} from '@musefold/contracts';
import { z } from 'zod';
import { createAuthedRouter, route } from '../../lib/openapi.js';
import type { DesignSchemeService } from './service.js';

const idParams = z.object({ id: opaqueIdSchema }).strict();
const detailRevisionQuery = z
  .object({
    revisionKind: z.enum(['current', 'working-draft']).default('current'),
    revisionId: opaqueIdSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.revisionKind === 'working-draft' && value.revisionId === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['revisionId'],
        message: 'A working-draft selector requires revisionId',
      });
    }
    if (value.revisionKind === 'current' && value.revisionId !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['revisionId'],
        message: 'A current selector cannot include revisionId',
      });
    }
  });

function detailInput(
  id: string,
  query: z.output<typeof detailRevisionQuery>,
): z.output<typeof designSchemeDetailInputSchema> {
  return designSchemeDetailInputSchema.parse({
    id,
    revision:
      query.revisionKind === 'working-draft'
        ? { kind: 'working-draft', revisionId: query.revisionId }
        : { kind: 'current' },
  });
}

/** Canonical Design Schemes HTTP surface. Every route is protected by the parent auth router. */
export function designSchemeRoutes(service: DesignSchemeService) {
  const app = createAuthedRouter();
  const tags = ['design-schemes'];

  route(
    app,
    {
      method: 'get',
      path: '/design-schemes',
      tags,
      query: designSchemeListQuerySchema,
      response: designSchemePageSchema,
    },
    async (c, input) => c.json(await service.list(c.get('userId'), input.query)),
  );

  route(
    app,
    {
      method: 'get',
      path: '/design-schemes/market',
      tags,
      query: marketSearchQuerySchema,
      response: marketSearchResultSchema,
    },
    async (c, input) => c.json(service.searchMarket(c.get('userId'), input.query)),
  );

  route(
    app,
    {
      method: 'post',
      path: '/design-schemes',
      tags,
      body: createDesignSchemeInputSchema,
      status: 201,
      response: createDesignSchemeResultSchema,
    },
    async (c, input) => c.json(await service.create(c.get('userId'), input.body), 201),
  );

  route(
    app,
    {
      method: 'get',
      path: '/design-schemes/{id}',
      tags,
      params: idParams,
      query: detailRevisionQuery,
      response: designSchemeDetailSchema,
    },
    async (c, input) =>
      c.json(await service.get(c.get('userId'), detailInput(input.params.id, input.query))),
  );

  route(
    app,
    {
      method: 'post',
      path: '/design-schemes/update',
      tags,
      body: updateDesignSchemeInputSchema,
      response: updateDesignSchemeResultSchema,
    },
    async (c, input) => c.json(await service.update(c.get('userId'), input.body)),
  );

  route(
    app,
    {
      method: 'post',
      path: '/design-schemes/modify',
      tags,
      body: modifyDesignSchemeInputSchema,
      response: modifyDesignSchemeResultSchema,
    },
    async (c, input) => c.json(service.modify(c.get('userId'), input.body)),
  );

  route(
    app,
    {
      method: 'post',
      path: '/design-schemes/cancel',
      tags,
      body: cancelDesignSchemeInputSchema,
      response: cancelDesignSchemeResultSchema,
    },
    async (c, input) => c.json(service.cancel(c.get('userId'), input.body)),
  );

  route(
    app,
    {
      method: 'post',
      path: '/design-schemes/confirm-install',
      tags,
      body: confirmDesignSchemeInstallInputSchema,
      response: confirmDesignSchemeInstallResultSchema,
    },
    async (c, input) => c.json(service.confirmInstall(c.get('userId'), input.body)),
  );

  route(
    app,
    {
      method: 'post',
      path: '/design-schemes/select-cover',
      tags,
      body: selectCoverInputSchema,
      response: selectCoverResultSchema,
    },
    async (c, input) => c.json(await service.selectCover(c.get('userId'), input.body)),
  );

  route(
    app,
    {
      method: 'post',
      path: '/design-schemes/formalize',
      tags,
      body: formalizeDesignSchemeInputSchema,
      response: formalizeDesignSchemeResultSchema,
    },
    async (c, input) => c.json(await service.formalize(c.get('userId'), input.body)),
  );

  route(
    app,
    {
      method: 'post',
      path: '/design-schemes/promote-working-draft',
      tags,
      body: promoteWorkingDraftInputSchema,
      response: promoteWorkingDraftResultSchema,
    },
    async (c, input) => c.json(await service.promoteWorkingDraft(c.get('userId'), input.body)),
  );

  route(
    app,
    {
      method: 'post',
      path: '/design-schemes/rename',
      tags,
      body: renameDesignSchemeInputSchema,
      response: renameDesignSchemeResultSchema,
    },
    async (c, input) => c.json(await service.rename(c.get('userId'), input.body)),
  );

  route(
    app,
    {
      method: 'post',
      path: '/design-schemes/remove',
      tags,
      body: removeDesignSchemeInputSchema,
      response: removeDesignSchemeResultSchema,
    },
    async (c, input) => c.json(await service.remove(c.get('userId'), input.body)),
  );

  route(
    app,
    {
      method: 'post',
      path: '/design-schemes/check-update',
      tags,
      body: checkDesignSchemeUpdateInputSchema,
      response: checkDesignSchemeUpdateResultSchema,
    },
    async (c, input) => c.json(service.checkUpdate(c.get('userId'), input.body)),
  );

  route(
    app,
    {
      method: 'post',
      path: '/design-schemes/prepare-import-package',
      tags,
      body: prepareDesignSchemeImportPackageInputSchema,
      response: prepareDesignSchemeImportPackageResultSchema,
    },
    async (c, input) => c.json(service.prepareImportPackage(c.get('userId'), input.body)),
  );

  route(
    app,
    {
      method: 'post',
      path: '/design-schemes/import-package',
      tags,
      body: importDesignSchemeInputSchema,
      response: importDesignSchemeResultSchema,
    },
    async (c, input) => c.json(service.importPackage(c.get('userId'), input.body)),
  );

  route(
    app,
    {
      method: 'post',
      path: '/design-schemes/export-package',
      tags,
      body: exportDesignSchemeInputSchema,
      response: exportDesignSchemeResultSchema,
    },
    async (c, input) => c.json(service.exportPackage(c.get('userId'), input.body)),
  );

  route(
    app,
    {
      method: 'post',
      path: '/design-schemes/run',
      tags,
      body: designSchemeRunInputSchema,
      response: runResultSchema,
    },
    async (c, input) => c.json(service.run(c.get('userId'), input.body)),
  );

  return app;
}
