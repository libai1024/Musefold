import {
  createWorkbenchSessionSchema,
  updateWorkbenchSessionSchema,
  workbenchSessionListQuerySchema,
} from '@musefold/contracts';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { SessionStorePort } from '../account/session-store.js';
import {
  requireMusefoldCsrf,
  requireMusefoldSession,
} from '../auth/request-auth.js';
import type { WorkbenchServicePort } from './service.js';

interface WorkbenchRoutesOptions {
  service: WorkbenchServicePort;
  sessions: SessionStorePort;
  cookieName: string;
}

const idParams = z.object({ id: z.string().trim().min(1).max(64) });
const versionBody = z.object({ expectedVersion: z.number().int().positive() });

export const workbenchRoutes: FastifyPluginAsync<
  WorkbenchRoutesOptions
> = async (app, options) => {
  const auth = requireMusefoldSession(options.sessions, options.cookieName);

  app.get(
    '/api/musefold/v1/workbench/sessions',
    {
      preHandler: auth,
      schema: {
        tags: ['workbench'],
        querystring: workbenchSessionListQuerySchema,
      },
    },
    async (request) => {
      return options.service.list(
        request.musefoldPrincipal.ownerId,
        workbenchSessionListQuerySchema.parse(request.query),
      );
    },
  );
  app.post(
    '/api/musefold/v1/workbench/sessions',
    {
      preHandler: [auth, requireMusefoldCsrf],
      schema: { tags: ['workbench'], body: createWorkbenchSessionSchema },
    },
    async (request, reply) => {
      const result = await options.service.create(
        request.musefoldPrincipal.ownerId,
        createWorkbenchSessionSchema.parse(request.body),
      );
      return reply.code(201).send(result);
    },
  );
  app.get(
    '/api/musefold/v1/workbench/sessions/:id',
    { preHandler: auth, schema: { tags: ['workbench'], params: idParams } },
    async (request) => {
      return options.service.get(
        request.musefoldPrincipal.ownerId,
        idParams.parse(request.params).id,
      );
    },
  );
  app.patch(
    '/api/musefold/v1/workbench/sessions/:id',
    {
      preHandler: [auth, requireMusefoldCsrf],
      schema: {
        tags: ['workbench'],
        params: idParams,
        body: updateWorkbenchSessionSchema,
      },
    },
    async (request) => {
      return options.service.update(
        request.musefoldPrincipal.ownerId,
        idParams.parse(request.params).id,
        updateWorkbenchSessionSchema.parse(request.body),
      );
    },
  );
  app.delete(
    '/api/musefold/v1/workbench/sessions/:id',
    {
      preHandler: [auth, requireMusefoldCsrf],
      schema: { tags: ['workbench'], params: idParams, body: versionBody },
    },
    async (request) => {
      const body = versionBody.parse(request.body);
      return options.service.remove(
        request.musefoldPrincipal.ownerId,
        idParams.parse(request.params).id,
        body.expectedVersion,
      );
    },
  );
  app.post(
    '/api/musefold/v1/workbench/sessions/:id/restore',
    {
      preHandler: [auth, requireMusefoldCsrf],
      schema: { tags: ['workbench'], params: idParams, body: versionBody },
    },
    async (request) => {
      const body = versionBody.parse(request.body);
      return options.service.restore(
        request.musefoldPrincipal.ownerId,
        idParams.parse(request.params).id,
        body.expectedVersion,
      );
    },
  );
};
