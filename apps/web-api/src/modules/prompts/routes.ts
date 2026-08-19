import {
  newPromptDocumentSchema,
  newPromptFolderSchema,
  newPromptTagSchema,
  promptListQuerySchema,
  promptUseInputSchema,
  updatePromptDocumentSchema,
  updatePromptFolderSchema,
  updatePromptTagSchema,
} from '@musefold/contracts';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { SessionStorePort } from '../account/session-store.js';
import {
  requireMusefoldCsrf,
  requireMusefoldSession,
} from '../auth/request-auth.js';
import type { PromptServicePort } from './service.js';

interface PromptRoutesOptions {
  promptService: PromptServicePort;
  sessions: SessionStorePort;
  cookieName: string;
}

const idParams = z.object({ id: z.string().trim().min(1).max(64) });
const expectedVersionBody = z.object({
  expectedVersion: z.number().int().positive(),
});
const includeDeletedQuery = z.object({
  includeDeleted: z.coerce.boolean().default(false),
});

export const promptRoutes: FastifyPluginAsync<PromptRoutesOptions> = async (
  app,
  options,
) => {
  const auth = requireMusefoldSession(options.sessions, options.cookieName);

  app.get(
    '/api/musefold/v1/prompts',
    {
      preHandler: auth,
      schema: { tags: ['prompts'], querystring: promptListQuerySchema },
    },
    async (request) => {
      const query = promptListQuerySchema.parse(
        normalizePromptQuery(request.query as Record<string, unknown>),
      );
      return options.promptService.listPrompts(
        request.musefoldPrincipal.ownerId,
        query,
      );
    },
  );

  app.post(
    '/api/musefold/v1/prompts',
    {
      preHandler: [auth, requireMusefoldCsrf],
      schema: { tags: ['prompts'], body: newPromptDocumentSchema },
    },
    async (request, reply) => {
      const result = await options.promptService.createPrompt(
        request.musefoldPrincipal.ownerId,
        newPromptDocumentSchema.parse(request.body),
      );
      return reply.code(201).send(result);
    },
  );

  app.get(
    '/api/musefold/v1/prompts/:id',
    { preHandler: auth, schema: { tags: ['prompts'], params: idParams } },
    async (request) => {
      return options.promptService.getPrompt(
        request.musefoldPrincipal.ownerId,
        idParams.parse(request.params).id,
      );
    },
  );

  app.patch(
    '/api/musefold/v1/prompts/:id',
    {
      preHandler: [auth, requireMusefoldCsrf],
      schema: {
        tags: ['prompts'],
        params: idParams,
        body: updatePromptDocumentSchema,
      },
    },
    async (request) => {
      return options.promptService.updatePrompt(
        request.musefoldPrincipal.ownerId,
        idParams.parse(request.params).id,
        updatePromptDocumentSchema.parse(request.body),
      );
    },
  );

  app.delete(
    '/api/musefold/v1/prompts/:id',
    {
      preHandler: [auth, requireMusefoldCsrf],
      schema: {
        tags: ['prompts'],
        params: idParams,
        body: expectedVersionBody,
      },
    },
    async (request) => {
      const body = expectedVersionBody.parse(request.body);
      return options.promptService.deletePrompt(
        request.musefoldPrincipal.ownerId,
        idParams.parse(request.params).id,
        body.expectedVersion,
      );
    },
  );

  app.post(
    '/api/musefold/v1/prompts/:id/restore',
    {
      preHandler: [auth, requireMusefoldCsrf],
      schema: {
        tags: ['prompts'],
        params: idParams,
        body: expectedVersionBody,
      },
    },
    async (request) => {
      const body = expectedVersionBody.parse(request.body);
      return options.promptService.restorePrompt(
        request.musefoldPrincipal.ownerId,
        idParams.parse(request.params).id,
        body.expectedVersion,
      );
    },
  );

  app.post(
    '/api/musefold/v1/prompts/:id/use',
    {
      preHandler: [auth, requireMusefoldCsrf],
      schema: {
        tags: ['prompts'],
        params: idParams,
        body: promptUseInputSchema,
      },
    },
    async (request) => {
      return options.promptService.usePrompt(
        request.musefoldPrincipal.ownerId,
        idParams.parse(request.params).id,
        promptUseInputSchema.parse(request.body),
      );
    },
  );

  app.get(
    '/api/musefold/v1/folders',
    {
      preHandler: auth,
      schema: { tags: ['prompts'], querystring: includeDeletedQuery },
    },
    async (request) => {
      return options.promptService.listFolders(
        request.musefoldPrincipal.ownerId,
        includeDeletedQuery.parse(request.query).includeDeleted,
      );
    },
  );

  app.post(
    '/api/musefold/v1/folders',
    {
      preHandler: [auth, requireMusefoldCsrf],
      schema: { tags: ['prompts'], body: newPromptFolderSchema },
    },
    async (request, reply) => {
      const result = await options.promptService.createFolder(
        request.musefoldPrincipal.ownerId,
        newPromptFolderSchema.parse(request.body),
      );
      return reply.code(201).send(result);
    },
  );

  app.patch(
    '/api/musefold/v1/folders/:id',
    {
      preHandler: [auth, requireMusefoldCsrf],
      schema: {
        tags: ['prompts'],
        params: idParams,
        body: updatePromptFolderSchema,
      },
    },
    async (request) => {
      return options.promptService.updateFolder(
        request.musefoldPrincipal.ownerId,
        idParams.parse(request.params).id,
        updatePromptFolderSchema.parse(request.body),
      );
    },
  );

  app.delete(
    '/api/musefold/v1/folders/:id',
    {
      preHandler: [auth, requireMusefoldCsrf],
      schema: {
        tags: ['prompts'],
        params: idParams,
        body: expectedVersionBody,
      },
    },
    async (request) => {
      const body = expectedVersionBody.parse(request.body);
      return options.promptService.deleteFolder(
        request.musefoldPrincipal.ownerId,
        idParams.parse(request.params).id,
        body.expectedVersion,
      );
    },
  );

  app.get(
    '/api/musefold/v1/tags',
    {
      preHandler: auth,
      schema: { tags: ['prompts'], querystring: includeDeletedQuery },
    },
    async (request) => {
      return options.promptService.listTags(
        request.musefoldPrincipal.ownerId,
        includeDeletedQuery.parse(request.query).includeDeleted,
      );
    },
  );

  app.post(
    '/api/musefold/v1/tags',
    {
      preHandler: [auth, requireMusefoldCsrf],
      schema: { tags: ['prompts'], body: newPromptTagSchema },
    },
    async (request, reply) => {
      const result = await options.promptService.createTag(
        request.musefoldPrincipal.ownerId,
        newPromptTagSchema.parse(request.body),
      );
      return reply.code(201).send(result);
    },
  );

  app.patch(
    '/api/musefold/v1/tags/:id',
    {
      preHandler: [auth, requireMusefoldCsrf],
      schema: {
        tags: ['prompts'],
        params: idParams,
        body: updatePromptTagSchema,
      },
    },
    async (request) => {
      return options.promptService.updateTag(
        request.musefoldPrincipal.ownerId,
        idParams.parse(request.params).id,
        updatePromptTagSchema.parse(request.body),
      );
    },
  );

  app.delete(
    '/api/musefold/v1/tags/:id',
    {
      preHandler: [auth, requireMusefoldCsrf],
      schema: {
        tags: ['prompts'],
        params: idParams,
        body: expectedVersionBody,
      },
    },
    async (request) => {
      const body = expectedVersionBody.parse(request.body);
      return options.promptService.deleteTag(
        request.musefoldPrincipal.ownerId,
        idParams.parse(request.params).id,
        body.expectedVersion,
      );
    },
  );
};

function normalizePromptQuery(
  query: Record<string, unknown>,
): Record<string, unknown> {
  const tagIds = query.tagIds;
  return {
    ...query,
    tagIds:
      typeof tagIds === 'string'
        ? tagIds
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
        : tagIds,
  };
}
