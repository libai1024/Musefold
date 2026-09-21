import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { AccountService } from '../account/service.js';
import type { PromptService } from '../prompts/service.js';
import type { SkillService } from './skills.js';

export type CloudMcpScope = 'account:read' | 'prompts:read' | 'skills:read';

/** requireMcpAuth 验证后的调用者身份(来自 JWT claims)。 */
export interface CloudMcpAuth {
  userId: string;
  clientId: string;
  scopes: readonly string[];
}

export interface CloudMcpDependencies {
  prompts: PromptService;
  skills: SkillService;
  account: AccountService;
  resourceUrl: string;
  /** 固定对外暴露的云端生图模型别名。 */
  modelAliases: readonly string[];
  /**
   * JWT 签名通过后仍须验证其绑定的 consent 行及可信会话。
   * 缺少持久授权校验时 fail closed，不能只按 user/client 判断后来的新授权。
   */
  isAuthorizationActive?(claims: Record<string, unknown>): Promise<boolean>;
}

export interface CloudMcpToolManifestEntry {
  name: string;
  requiredScope: CloudMcpScope;
  readOnly: true;
  register: (server: McpServer, auth: CloudMcpAuth, deps: CloudMcpDependencies) => void;
}

const asResult = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
});

/**
 * 云端 MCP 只读白名单(与旧版七工具一一对应)。
 * 生图/写操作刻意不在白名单内;审批与花费预留流程在 v2.5 处于休眠,不迁移。
 */
export const CLOUD_MCP_TOOL_MANIFEST: readonly CloudMcpToolManifestEntry[] = [
  {
    name: 'musefold_status',
    requiredScope: 'account:read',
    readOnly: true,
    register: (server, auth, deps) => {
      server.registerTool(
        'musefold_status',
        {
          title: 'Musefold 状态',
          description: 'Return redacted Cloud MCP connection and capability status.',
        },
        async () =>
          asResult({
            connected: true,
            surface: 'cloud',
            clientId: auth.clientId,
            scopes: auth.scopes,
            resource: deps.resourceUrl,
            capabilities: ['account', 'prompts', 'official_skills'],
          }),
      );
    },
  },
  {
    name: 'get_account_status',
    requiredScope: 'account:read',
    readOnly: true,
    register: (server, auth, deps) => {
      server.registerTool(
        'get_account_status',
        {
          title: '账号状态',
          description:
            'Return a redacted account capability summary. Credentials and upstream tokens are never returned.',
        },
        async () =>
          asResult({
            ownerId: auth.userId,
            officialModelsAvailable: deps.modelAliases.length > 0,
            quota: null,
            quotaUnit: 'points',
            budget: null,
          }),
      );
    },
  },
  {
    name: 'list_models',
    requiredScope: 'account:read',
    readOnly: true,
    register: (server, _auth, deps) => {
      server.registerTool(
        'list_models',
        {
          title: '列出模型',
          description: 'List the fixed cloud image model aliases exposed to this grant.',
        },
        async () =>
          asResult({
            models: deps.modelAliases.map((id) => ({
              id,
              kind: 'image',
              sizes: ['auto', '1024x1024', '1536x1024', '1024x1536'],
              qualities: ['auto', 'low', 'medium', 'high'],
            })),
          }),
      );
    },
  },
  {
    name: 'search_prompts',
    requiredScope: 'prompts:read',
    readOnly: true,
    register: (server, auth, deps) => {
      server.registerTool(
        'search_prompts',
        {
          title: '搜索提示词',
          description: 'Search the authenticated user cloud prompt library.',
          inputSchema: {
            q: z.string().max(200).optional(),
            limit: z.number().int().min(1).max(50).optional(),
          },
        },
        async (args: { q?: string; limit?: number }) =>
          asResult(
            await deps.prompts.listPrompts(auth.userId, {
              q: args.q,
              limit: args.limit ?? 20,
              includeDeleted: false,
              sort: 'updated-desc',
            }),
          ),
      );
    },
  },
  {
    name: 'get_prompt',
    requiredScope: 'prompts:read',
    readOnly: true,
    register: (server, auth, deps) => {
      server.registerTool(
        'get_prompt',
        {
          title: '读取提示词',
          description: 'Read one authenticated user cloud prompt.',
          inputSchema: { id: z.string().min(1).max(64) },
        },
        async (args: { id: string }) =>
          asResult(await deps.prompts.getPrompt(auth.userId, args.id)),
      );
    },
  },
  {
    name: 'list_skills',
    requiredScope: 'skills:read',
    readOnly: true,
    register: (server, _auth, deps) => {
      server.registerTool(
        'list_skills',
        {
          title: '列出官方 Skills',
          description: 'List published, audited, code-free Musefold visual skills.',
        },
        async () => asResult({ skills: await deps.skills.list() }),
      );
    },
  },
  {
    name: 'get_skill',
    requiredScope: 'skills:read',
    readOnly: true,
    register: (server, _auth, deps) => {
      server.registerTool(
        'get_skill',
        {
          title: '读取官方 Skill',
          description:
            'Read one pinned official skill version, schema and content hash. The server never executes skill code.',
          inputSchema: {
            id: z.string().min(1).max(120),
            version: z.string().min(1).max(32),
          },
        },
        async (args: { id: string; version: string }) =>
          asResult(await deps.skills.get(args.id, args.version)),
      );
    },
  },
];

export const CLOUD_MCP_TOOL_NAMES = CLOUD_MCP_TOOL_MANIFEST.map((entry) => entry.name);

export function enabledCloudMcpTools(
  scopes: readonly string[],
): readonly CloudMcpToolManifestEntry[] {
  return CLOUD_MCP_TOOL_MANIFEST.filter((entry) => scopes.includes(entry.requiredScope));
}
