import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mcpRoutes } from './routes.js';
import { SkillService } from './skills.js';

const apps: ReturnType<typeof Fastify>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function createApp() {
  const app = Fastify({ logger: false });
  apps.push(app);
  const oauth = { verifyAccessToken: vi.fn() };
  const rateLimiter = { assertAllowed: vi.fn() };
  await app.register(mcpRoutes, {
    oauth: oauth as never,
    prompts: {} as never,
    skills: {} as never,
    config: {
      PUBLIC_ORIGIN: 'https://musefold.example',
      MCP_RESOURCE_URL: 'https://musefold.example/api/musefold/mcp',
    },
    rateLimiter,
  });
  return { app, oauth, rateLimiter };
}

describe('Cloud MCP HTTP boundary', () => {
  it('validates official Skill inputs against the published JSON schema', () => {
    const service = new SkillService({} as never);
    const skill = {
      id: 'postcard',
      version: '1.0.0',
      title: '明信片视觉',
      summary: '测试',
      content: '# Skill',
      inputSchema: {
        type: 'object',
        properties: { subject: { type: 'string', minLength: 1 } },
        required: ['subject'],
        additionalProperties: false,
      },
      contentHash: 'sha256:' + 'a'.repeat(64),
    };
    expect(() => service.validateInputs(skill, { subject: '咖啡馆' })).not.toThrow();
    expect(() => service.validateInputs(skill, {})).toThrow('Skill 输入不符合 schema');
    expect(() => service.validateInputs(skill, { subject: '咖啡馆', extra: true })).toThrow(
      'Skill 输入不符合 schema',
    );
  });

  it('rejects browser origins outside the canonical Web origin before auth', async () => {
    const { app, oauth, rateLimiter } = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/musefold/mcp',
      headers: { origin: 'https://evil.example' },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'origin_not_allowed' });
    expect(oauth.verifyAccessToken).not.toHaveBeenCalled();
    expect(rateLimiter.assertAllowed).not.toHaveBeenCalled();
  });

  it('filters tools/list to the scopes present on the grant', async () => {
    const { app, oauth } = await createApp();
    oauth.verifyAccessToken.mockResolvedValue({
      token: 'account-only-token',
      ownerId: 42,
      clientId: 'account-only-client',
      grantId: 'account-only-grant',
      scopes: ['account:read'],
      resource: 'https://musefold.example/api/musefold/mcp',
      expiresAt: Math.floor(Date.now() / 1_000) + 600,
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string')
      throw new Error('Fastify did not expose a TCP test address');
    const client = new Client({ name: 'musefold-scope-test', version: '1.0.0' });
    try {
      await client.connect(
        new StreamableHTTPClientTransport(
          new URL(`http://127.0.0.1:${address.port}/api/musefold/mcp`),
          { requestInit: { headers: { Authorization: 'Bearer account-only-token' } } },
        ),
      );
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
        'musefold_status',
        'get_account_status',
        'list_models',
      ]);
    } finally {
      await client.close();
    }
  });

  it('completes initialize, tools/list and tools/call with the official Streamable HTTP client', async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    const oauth = {
      verifyAccessToken: vi.fn().mockResolvedValue({
        token: 'test-access-token',
        ownerId: 42,
        clientId: 'sdk-client',
        grantId: 'grant-1',
        scopes: ['account:read', 'prompts:read', 'skills:read'],
        resource: 'http://127.0.0.1/api/musefold/mcp',
        expiresAt: Math.floor(Date.now() / 1_000) + 600,
      }),
      assertScope: vi.fn(),
      getGrant: vi.fn().mockResolvedValue({
        id: 'grant-1',
        ownerId: 42,
        clientId: 'sdk-client',
        scopes: ['account:read'],
        mode: 'ask_each_time',
        maxPointsPerGeneration: 1_000,
        maxPointsPerDay: 10_000,
        allowedModelAliases: ['musefold-image-pro'],
        suspended: false,
      }),
    };
    const prompts = {
      listPrompts: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      getPrompt: vi.fn().mockResolvedValue({
        id: 'prompt-1',
        title: 'Editorial still life',
        content: 'A quiet editorial still life',
      }),
    };
    const skills = {
      list: vi.fn().mockResolvedValue([
        {
          id: 'postcard',
          version: '1.0.0',
          title: '明信片视觉',
          summary: '测试',
          contentHash: 'sha256:' + 'a'.repeat(64),
        },
      ]),
      get: vi.fn().mockResolvedValue({
        id: 'postcard',
        version: '1.0.0',
        title: '明信片视觉',
        summary: '测试',
        content: '# Skill',
        inputSchema: { type: 'object', additionalProperties: false },
        contentHash: 'sha256:' + 'a'.repeat(64),
      }),
    };
    await app.register(mcpRoutes, {
      oauth: oauth as never,
      prompts: prompts as never,
      skills: skills as never,
      config: {
        PUBLIC_ORIGIN: 'https://musefold.example',
        MCP_RESOURCE_URL: 'https://musefold.example/api/musefold/mcp',
      },
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string')
      throw new Error('Fastify did not expose a TCP test address');

    const client = new Client({ name: 'musefold-sdk-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${address.port}/api/musefold/mcp`),
      {
        requestInit: {
          headers: { Authorization: 'Bearer test-access-token' },
        },
      },
    );
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name).sort();
      expect(names).toEqual([
        'get_account_status',
        'get_prompt',
        'get_skill',
        'list_models',
        'list_skills',
        'musefold_status',
        'search_prompts',
      ]);
      expect(names).not.toEqual(
        expect.arrayContaining([
          'save_prompt',
          'generate_image',
          'estimate_generation',
          'get_generation',
          'wait_for_generation',
          'cancel_generation',
          'list_history',
        ]),
      );
      const status = await client.callTool({
        name: 'musefold_status',
        arguments: {},
      });
      expect(status.structuredContent).toMatchObject({
        connected: true,
        surface: 'cloud',
        clientId: 'sdk-client',
        capabilities: ['account', 'prompts', 'official_skills'],
      });
      const account = await client.callTool({
        name: 'get_account_status',
        arguments: {},
      });
      expect(account.structuredContent).toMatchObject({
        ownerId: '42',
        officialModelsAvailable: true,
      });
      const models = await client.callTool({
        name: 'list_models',
        arguments: {},
      });
      expect(models.structuredContent).toMatchObject({
        models: [{ id: 'musefold-image-pro', kind: 'image' }],
      });
      const promptPage = await client.callTool({
        name: 'search_prompts',
        arguments: { q: 'editorial' },
      });
      expect(promptPage.structuredContent).toMatchObject({ items: [] });
      const prompt = await client.callTool({
        name: 'get_prompt',
        arguments: { id: 'prompt-1' },
      });
      expect(prompt.structuredContent).toMatchObject({
        id: 'prompt-1',
        content: 'A quiet editorial still life',
      });
      const skillsPage = await client.callTool({
        name: 'list_skills',
        arguments: {},
      });
      expect(skillsPage.structuredContent).toMatchObject({
        skills: [{ id: 'postcard', version: '1.0.0' }],
      });
      const skill = await client.callTool({
        name: 'get_skill',
        arguments: { id: 'postcard', version: '1.0.0' },
      });
      expect(skill.structuredContent).toMatchObject({
        id: 'postcard',
        contentHash: 'sha256:' + 'a'.repeat(64),
      });
      const serialized = JSON.stringify({
        status: status.structuredContent,
        account: account.structuredContent,
        models: models.structuredContent,
        prompt: prompt.structuredContent,
        skills: skill.structuredContent,
      });
      expect(serialized).not.toMatch(/password|token|cookie|apiKey|secret|file:\/\//i);
      expect(oauth.assertScope).toHaveBeenCalledWith(
        expect.objectContaining({ ownerId: 42 }),
        expect.any(String),
      );
      expect(oauth.verifyAccessToken).toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });
});
