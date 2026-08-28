import {
  createWorkbenchSessionSchema,
  updateWorkbenchSessionSchema,
  workbenchSessionListQuerySchema,
  workbenchSessionPageSchema,
  workbenchSessionSchema,
} from '@musefold/contracts';
import { z } from 'zod';
import { createAuthedRouter, route } from '../../lib/openapi.js';
import type { WorkbenchService } from './service.js';

const idParams = z.object({ id: z.string().trim().min(1).max(64) });
const versionBody = z.object({ expectedVersion: z.number().int().positive() });

export function workbenchRoutes(service: WorkbenchService) {
  const app = createAuthedRouter();
  const tags = ['workbench'];

  route(
    app,
    {
      method: 'get',
      path: '/workbench/sessions',
      tags,
      query: workbenchSessionListQuerySchema,
      response: workbenchSessionPageSchema,
    },
    async (c, input) => c.json(await service.list(c.get('userId'), input.query)),
  );

  route(
    app,
    {
      method: 'post',
      path: '/workbench/sessions',
      tags,
      body: createWorkbenchSessionSchema,
      status: 201,
      response: workbenchSessionSchema,
    },
    async (c, input) => c.json(await service.create(c.get('userId'), input.body), 201),
  );

  route(
    app,
    {
      method: 'get',
      path: '/workbench/sessions/{id}',
      tags,
      params: idParams,
      response: workbenchSessionSchema,
    },
    async (c, input) => c.json(await service.get(c.get('userId'), input.params.id)),
  );

  route(
    app,
    {
      method: 'patch',
      path: '/workbench/sessions/{id}',
      tags,
      params: idParams,
      body: updateWorkbenchSessionSchema,
      response: workbenchSessionSchema,
    },
    async (c, input) => c.json(await service.update(c.get('userId'), input.params.id, input.body)),
  );

  route(
    app,
    {
      method: 'delete',
      path: '/workbench/sessions/{id}',
      tags,
      params: idParams,
      body: versionBody,
      response: workbenchSessionSchema,
    },
    async (c, input) =>
      c.json(await service.remove(c.get('userId'), input.params.id, input.body.expectedVersion)),
  );

  route(
    app,
    {
      method: 'post',
      path: '/workbench/sessions/{id}/restore',
      tags,
      params: idParams,
      body: versionBody,
      response: workbenchSessionSchema,
    },
    async (c, input) =>
      c.json(await service.restore(c.get('userId'), input.params.id, input.body.expectedVersion)),
  );

  return app;
}
