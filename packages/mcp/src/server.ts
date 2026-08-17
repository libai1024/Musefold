// musefold-mcp（V04-MCP-SERVER-SPEC）：无状态薄适配器——
// 把策展工具面翻译为对本地控制面（Automation API v1）的 HTTP 调用。
// 纪律：日志一律 stderr；stdout 归 stdio 传输所有；自身不开库、不存密钥。

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { MusefoldClient, MusefoldClientError, discoverOrStartEndpoint } from '@musefold/client';
import packageInfo from '../package.json';

export interface McpServerOptions {
  /** 显式端点（缺省走发现链） */
  endpoint?: string;
  token?: string;
  /** 只注册 🟢 只读工具 */
  readonly?: boolean;
  /** 裁剪工具组 */
  toolsets?: string[];
  /** 长任务默认「提交即返回 jobId」 */
  noWait?: boolean;
  /** 缺省开启：MCP 找不到控制面时拉起同一安装目录下的桌面 App。 */
  autostart?: boolean;
  appExecutable?: string;
  env?: NodeJS.ProcessEnv;
  logger?: (line: string) => void;
}

const SERVER_INFO = { name: 'musefold', version: packageInfo.version };

/**
 * SDK registerTool/registerPrompt 的 zod 深推断在本项目类型宇宙里会触发 TS2589
 * （运行时行为由 mcp-server.test.ts 全量覆盖）。集成缝上显式退化为 any，
 * 同时把类型检查从 60s+/8GB 拉回正常量级。
 */
type AnyToolConfig = { title: string; description: string; inputSchema: Record<string, unknown>; annotations?: Record<string, unknown> };
interface ToolHandlerExtra {
  signal: AbortSignal;
  _meta?: { progressToken?: string | number };
  sendNotification(notification: {
    method: 'notifications/progress';
    params: { progressToken: string | number; progress: number; total?: number; message?: string };
  }): Promise<void>;
}
function addTool(server: McpServer, name: string, config: AnyToolConfig, handler: (args: any, extra: ToolHandlerExtra) => Promise<unknown>): void {
  (server.registerTool as unknown as (n: string, c: unknown, h: unknown) => void)(name, config, handler);
}
function addPrompt(server: McpServer, name: string, config: Record<string, unknown>, handler: (args: any) => unknown): void {
  (server.registerPrompt as unknown as (n: string, c: unknown, h: unknown) => void)(name, config, handler);
}

type ToolLevel = 'read' | 'write' | 'spend';

interface ToolGroupSpec {
  group: string;
  register(server: McpServer, client: MusefoldClient, options: McpServerOptions): void;
}

function registerSetupTools(
  server: McpServer,
  client: MusefoldClient,
  level: (toolLevel: ToolLevel) => boolean,
): void {
  addTool(server, 'get_setup_status', {
    title: '检查接入配置',
    description: 'Read redacted account/provider readiness and the active provider. Never returns usernames, server URLs, key suffixes, tokens, or credentials.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => {
    try { return textResult(await client.setupStatus()); } catch (error) { return errorResult(error); }
  });

  if (!level('write')) return;
  addTool(server, 'select_provider', {
    title: '选择接入方式',
    description: 'Switch to an already configured account or relay provider. Reversible and never handles credentials.',
    inputSchema: { providerId: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async (args) => {
    try { return textResult(await client.selectProvider(args.providerId)); } catch (error) { return errorResult(error); }
  });

  addTool(server, 'open_account_setup', {
    title: '打开账号配置',
    description: 'Focus Musefold and open its native login/register form. Ask the user to enter credentials only there; never ask for or pass a username or password in chat.',
    inputSchema: { mode: z.enum(['login', 'register']).optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async (args) => {
    try { return textResult(await client.openAccountSetup(args.mode)); } catch (error) { return errorResult(error); }
  });

  addTool(server, 'open_provider_setup', {
    title: '打开中转站配置',
    description: 'Focus Musefold and open its native provider form, optionally prefilling non-secret fields. The user must enter the API key and test connectivity inside Musefold.',
    inputSchema: {
      name: z.string().max(80).optional(),
      type: z.enum(['openai', 'openai-compatible', 'wukong-studio']).optional(),
      baseUrl: z.string().max(2048).optional(),
      model: z.string().max(160).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async (args) => {
    try { return textResult(await client.openProviderSetup(args)); } catch (error) { return errorResult(error); }
  });
}

function textResult(payload: unknown, extra: { isError?: boolean; links?: Array<{ uri: string; name: string }> } = {}) {
  return {
    ...(extra.isError ? { isError: true } : {}),
    structuredContent: undefined,
    content: [
      { type: 'text' as const, text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) },
      ...(extra.links ?? []).map((link) => ({
        type: 'resource_link' as const,
        uri: link.uri,
        name: link.name,
        mimeType: 'image/png' as const,
      })),
    ],
  };
}

function errorResult(error: unknown) {
  if (error instanceof MusefoldClientError) {
    return textResult(
      { error: { code: error.code, message: error.message, retriable: error.code === 'NOT_CONNECTED' } },
      { isError: true },
    );
  }
  return textResult(
    { error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) } },
    { isError: true },
  );
}

function generationResult(detail: Awaited<ReturnType<MusefoldClient['getGeneration']>>) {
  return textResult(
    {
      jobId: detail.jobId,
      status: detail.status,
      historyId: detail.historyId,
      costCents: detail.costCents ?? null,
      cost: detail.cost ?? null,
      costUnit: detail.costUnit ?? 'cny_cent',
      durationMs: detail.durationMs ?? null,
      assets: detail.assets ?? [],
      actualSize: detail.actualSize ?? null,
      sizeMismatch: detail.sizeMismatch ?? null,
      ...(detail.error ? { error: detail.error } : {}),
    },
    {
      isError: detail.status !== 'success',
      links: (detail.assets ?? []).map((asset, index) => ({
        uri: `file://${asset.path}`,
        name: `image-${index + 1}.png`,
      })),
    },
  );
}

function forwardProgress(extra: ToolHandlerExtra | undefined, payload: unknown): void {
  const progressToken = extra?._meta?.progressToken;
  if (!extra || progressToken === undefined) return;
  const event = payload as { phase?: unknown; percent?: unknown };
  const percent = typeof event.percent === 'number' && Number.isFinite(event.percent)
    ? Math.min(100, Math.max(0, event.percent))
    : 0;
  void extra.sendNotification({
    method: 'notifications/progress',
    params: {
      progressToken,
      progress: percent,
      total: 100,
      ...(typeof event.phase === 'string' && event.phase ? { message: event.phase } : {}),
    },
  }).catch(() => undefined);
}

/** 基础工具注册表；桌面宿主会按 capability 追加安全配置工具。 */
function toolGroups(level: (toolLevel: ToolLevel) => boolean): ToolGroupSpec[] {
  return [
    {
      group: 'library',
      register(server, client) {
        addTool(server, 'search_prompts', {
          title: '检索提示词库',
          description: 'Full-text search over the Musefold prompt library (including quick slips). Read-only.',
          inputSchema: {
            query: z.string().optional().describe('FTS query, e.g. "cyberpunk street"'),
            source: z.enum(['manual', 'slip', 'any']).optional(),
            limit: z.number().int().min(1).max(50).optional(),
          },
          annotations: { readOnlyHint: true },
        }, async (args) => {
          try {
            return textResult(await client.prompts({ query: args.query, source: args.source, limit: args.limit }));
          } catch (error) { return errorResult(error); }
        });

        addTool(server, 'get_prompt', {
          title: '读取提示词',
          description: 'Fetch one prompt with full body by id. Read-only.',
          inputSchema: { id: z.string() },
          annotations: { readOnlyHint: true },
        }, async (args) => {
          try { return textResult(await client.prompt(args.id)); } catch (error) { return errorResult(error); }
        });

        if (level('write')) {
          addTool(server, 'save_prompt', {
            title: '保存提示词',
            description: 'Save a good prompt back into the Musefold library (goes to the library, recoverable via trash).',
            inputSchema: {
              title: z.string().max(120),
              body: z.string().max(20_000),
              note: z.string().max(500).optional().describe('Provenance note, e.g. "via Claude Code 2026-08-13"'),
            },
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
          }, async (args) => {
            try { return textResult(await client.savePrompt(args)); } catch (error) { return errorResult(error); }
          });
        }
      },
    },
    {
      group: 'generation',
      register(server, client, options) {
        addTool(server, 'list_providers', {
          title: '列出图像 Provider',
          description: 'List configured image providers. Never contains any API key material.',
          inputSchema: {},
          annotations: { readOnlyHint: true },
        }, async () => {
          try {
            const { providers } = await client.providers();
            // MCP 面不透出 keySuffix（V04-SECURITY §8）
            return textResult({
              providers: providers.map(({ keySuffix: _drop, ...provider }) => provider),
            });
          } catch (error) { return errorResult(error); }
        });

        addTool(server, 'list_provider_models', {
          title: '列出 Provider 模型',
          description: 'List image models available from one configured provider. Read-only and contains no credentials.',
          inputSchema: { providerId: z.string() },
          annotations: { readOnlyHint: true },
        }, async (args) => {
          try { return textResult(await client.providerModels(args.providerId)); } catch (error) { return errorResult(error); }
        });

        if (level('spend')) {
          addTool(server, 'generate_image', {
            title: '生成图片',
            description: [
              'Generate images via the active Musefold provider, with optional reference images or history assets.',
              'Costs real money: the Musefold desktop app will ask the user to confirm unless an automation budget covers the estimate.',
              'By default this call stays open, reports progress, and returns the final assets; set your client tool timeout to 300s.',
              'For background submission pass wait:false, then call wait_for_generation once instead of polling.',
            ].join(' '),
            inputSchema: {
              prompt: z.string().min(1),
              providerId: z.string().optional(),
              model: z.string().optional(),
              aspectRatio: z.enum(['1:1', '3:4', '4:3', '16:9', '9:16']).optional(),
              n: z.number().int().min(1).max(4).optional(),
              quality: z.enum(['auto', 'high', 'medium', 'low']).optional(),
              negative: z.string().optional(),
              referenceImagePaths: z.array(z.string()).max(16).optional(),
              referenceHistoryIds: z.array(z.string()).max(16).optional(),
              wait: z.boolean().optional().describe('default true; false returns jobId immediately'),
            },
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
          }, async (args, extra) => {
            try {
              const { wait, ...body } = args;
              const submitted = await client.startGeneration(body);
              const shouldWait = wait ?? !options.noWait;
              if (!shouldWait) return textResult({ jobId: submitted.jobId, status: submitted.status });
              const detail = await client.waitForGeneration(submitted.jobId, {
                signal: extra.signal,
                onEvent: (event) => {
                  if (event.type === 'generation.progress') forwardProgress(extra, event.payload);
                },
              });
              return generationResult(detail);
            } catch (error) { return errorResult(error); }
          });

          addTool(server, 'cancel_generation', {
            title: '取消生成',
            description: 'Cancel a running generation job by jobId. Idempotent.',
            inputSchema: { jobId: z.string() },
            annotations: { readOnlyHint: false, idempotentHint: true },
          }, async (args) => {
            try { return textResult(await client.cancelGeneration(args.jobId)); } catch (error) { return errorResult(error); }
          });
        }

        addTool(server, 'get_generation', {
          title: '查询生成任务',
          description: 'Read one current generation snapshot by jobId. For completion notification use wait_for_generation instead of polling.',
          inputSchema: { jobId: z.string() },
          annotations: { readOnlyHint: true },
        }, async (args) => {
          try { return textResult(await client.getGeneration(args.jobId)); } catch (error) { return errorResult(error); }
        });

        addTool(server, 'wait_for_generation', {
          title: '等待生成完成',
          description: 'Wait for a submitted generation job via Musefold events, report progress, and return final image links. Call once after generate_image(wait:false); do not poll.',
          inputSchema: { jobId: z.string() },
          annotations: { readOnlyHint: true, openWorldHint: true },
        }, async (args, extra) => {
          try {
            const detail = await client.waitForGeneration(args.jobId, {
              signal: extra.signal,
              onEvent: (event) => {
                if (event.type === 'generation.progress') forwardProgress(extra, event.payload);
              },
            });
            return generationResult(detail);
          } catch (error) { return errorResult(error); }
        });
      },
    },
    {
      group: 'schemes',
      register(server, client, options) {
        addTool(server, 'list_schemes', {
          title: '列出设计方案',
          description: 'List formal design schemes (visual production skills). Drafts are never exposed. Read-only.',
          inputSchema: {},
          annotations: { readOnlyHint: true },
        }, async () => {
          try { return textResult(await client.schemes()); } catch (error) { return errorResult(error); }
        });

        addTool(server, 'get_scheme', {
          title: '读取方案详情',
          description: 'Fetch scheme detail: input slots (text/image, required flags), constraints, source binding. Read-only.',
          inputSchema: { id: z.string() },
          annotations: { readOnlyHint: true },
        }, async (args) => {
          try { return textResult(await client.scheme(args.id)); } catch (error) { return errorResult(error); }
        });

        addTool(server, 'compile_scheme_prompt', {
          title: '编译方案提示词',
          description: 'Preview the final prompt a scheme would produce for given inputs. Zero cost, read-only.',
          inputSchema: {
            schemeId: z.string(),
            inputs: z.record(z.string(), z.string()).optional(),
            brief: z.string().optional(),
            ratioId: z.string().optional(),
            priorityMode: z.enum(['scheme_first', 'user_first', 'agent_mediated']).optional(),
          },
          annotations: { readOnlyHint: true, idempotentHint: true },
        }, async (args) => {
          try {
            const { schemeId, ...input } = args;
            return textResult(await client.compileScheme(schemeId, input));
          } catch (error) { return errorResult(error); }
        });

        if (level('spend')) {
          addTool(server, 'run_scheme', {
            title: '运行设计方案',
            description: 'Run a formal design scheme to generate images (costs money; desktop confirmation or budget applies). May take minutes; supports wait:false + get_generation polling.',
            inputSchema: {
              schemeId: z.string(),
              inputs: z.record(z.string(), z.string()).optional(),
              brief: z.string().optional(),
              ratioId: z.string().optional(),
              priorityMode: z.enum(['scheme_first', 'user_first', 'agent_mediated']).optional(),
              wait: z.boolean().optional(),
            },
            annotations: { readOnlyHint: false, openWorldHint: true },
          }, async (args) => {
            try {
              const { schemeId, wait, ...input } = args;
              const submitted = await client.request<{ jobId: string; status: string }>(
                `/v1/schemes/${encodeURIComponent(schemeId)}/runs`,
                { method: 'POST', body: JSON.stringify(input), signal: AbortSignal.timeout(150_000) },
              );
              const shouldWait = wait ?? !options.noWait;
              if (!shouldWait) return textResult(submitted);
              type RunDetail = {
                jobId: string; status: string; assets?: Array<{ path: string }>; costCents?: number | null;
                cost?: number | null; costUnit?: 'cny_cent' | 'point'; error?: unknown;
              };
              let detail = await client.request<RunDetail>(`/v1/scheme-runs/${submitted.jobId}`);
              while (detail.status === 'running') {
                await new Promise((resolve) => setTimeout(resolve, 1000));
                detail = await client.request<RunDetail>(`/v1/scheme-runs/${submitted.jobId}`);
              }
              return textResult(detail, {
                isError: detail.status !== 'success',
                links: (detail.assets ?? []).map((asset, index) => ({ uri: `file://${asset.path}`, name: `image-${index + 1}.png` })),
              });
            } catch (error) { return errorResult(error); }
          });
        }
      },
    },
    {
      group: 'skills',
      register(server, client, options) {
        if (!level('spend')) return;
        addTool(server, 'run_github_skill', {
          title: '运行 GitHub Skill',
          description: 'Fetch a public GitHub visual skill (pinned commit, scripts are NEVER executed) and generate images following its rules. Requires a configured text AI connection; costs money (confirmation/budget applies).',
          inputSchema: {
            url: z.string().url(),
            prompt: z.string(),
            wait: z.boolean().optional(),
          },
          annotations: { readOnlyHint: false, openWorldHint: true },
        }, async (args) => {
          try {
            const submitted = await client.request<{ jobId: string; status: string }>(
              '/v1/skills/github/run',
              { method: 'POST', body: JSON.stringify({ url: args.url, prompt: args.prompt }), signal: AbortSignal.timeout(150_000) },
            );
            const shouldWait = args.wait ?? !options.noWait;
            if (!shouldWait) return textResult(submitted);
            type RunDetail = {
              jobId: string; status: string; assets?: Array<{ path: string }>; costCents?: number | null;
              cost?: number | null; costUnit?: 'cny_cent' | 'point'; stepSummaries?: string[]; error?: unknown;
            };
            let detail = await client.request<RunDetail>(`/v1/skill-runs/${submitted.jobId}`);
            while (detail.status === 'running') {
              await new Promise((resolve) => setTimeout(resolve, 2000));
              detail = await client.request<RunDetail>(`/v1/skill-runs/${submitted.jobId}`);
            }
            return textResult(detail, { isError: detail.status !== 'success' });
          } catch (error) { return errorResult(error); }
        });
      },
    },
    {
      group: 'history',
      register(server, client) {
        addTool(server, 'list_history', {
          title: '列出生成历史',
          description: 'List generation history rows (status, cost in cents, asset paths). Read-only.',
          inputSchema: {
            limit: z.number().int().min(1).max(50).optional(),
            status: z.enum(['success', 'failed', 'cancelled']).optional(),
            providerId: z.string().optional(),
          },
          annotations: { readOnlyHint: true },
        }, async (args) => {
          try { return textResult(await client.history(args)); } catch (error) { return errorResult(error); }
        });
      },
    },
  ];
}

export interface CreatedMcpServer {
  server: McpServer;
  connected: boolean;
}

export async function createMusefoldMcpServer(options: McpServerOptions = {}): Promise<CreatedMcpServer> {
  const log = options.logger ?? ((line: string) => process.stderr.write(`${line}\n`));
  const server = new McpServer(SERVER_INFO);
  const env = options.env ?? process.env;

  let client: MusefoldClient | null = null;
  if (options.endpoint && options.token) {
    client = new MusefoldClient({ endpoint: options.endpoint, token: options.token });
  } else {
    const discovered = await discoverOrStartEndpoint({
      env,
      autostart: options.autostart ?? env.MUSEFOLD_AUTOSTART !== '0',
      executable: options.appExecutable,
      logger: log,
    });
    if (discovered) client = new MusefoldClient({ endpoint: discovered.endpoint, token: discovered.token });
  }

  // 连接探活：拿不到控制面 → 降级目录（只注册 musefold_status，客户端不喜欢启动即失败）
  let connected = false;
  let health: Record<string, unknown> | null = null;
  if (client) {
    try {
      health = await client.health();
      connected = true;
    } catch {
      connected = false;
    }
  }

  addTool(server, 'musefold_status', {
    title: '连接诊断',
    description: 'Check the connection to the local Musefold app and get capability/data counts. Always available.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => {
    if (!client) {
      return textResult({
        connected: false,
        guidance: '无法连接 Musefold 0.5 桌面控制面。请启动 Musefold，并在“设置 > 自动化”中开启本地控制面，然后重启本 MCP 服务器。桌面账号不会提供给 `musefold serve`。',
      });
    }
    try {
      return textResult({ connected: true, ...(await client.health()) });
    } catch (error) {
      return errorResult(error);
    }
  });

  if (connected && client) {
    const enabledGroups = options.toolsets?.length ? new Set(options.toolsets) : null;
    const levelAllowed = (toolLevel: ToolLevel) => (options.readonly ? toolLevel === 'read' : true);
    for (const spec of toolGroups(levelAllowed)) {
      if (enabledGroups && !enabledGroups.has(spec.group)) continue;
      spec.register(server, client, options);
    }
    const capabilities = health?.capabilities as Record<string, unknown> | undefined;
    if (capabilities?.setup === true && (!enabledGroups || enabledGroups.has('setup'))) {
      registerSetupTools(server, client, levelAllowed);
    }

    // Resources：提示词正文（客户端可按需读取，不把大文本塞进工具输出）
    server.registerResource(
      'prompt',
      new ResourceTemplate('musefold://prompt/{id}', { list: undefined }),
      { title: 'Musefold 提示词', description: 'Prompt body by id', mimeType: 'text/markdown' },
      async (uri, variables) => {
        const id = String(variables.id ?? '');
        const { prompt } = await client!.prompt(id);
        return {
          contents: [{ uri: uri.href, mimeType: 'text/markdown', text: `# ${String(prompt.title)}\n\n${String(prompt.content)}` }],
        };
      },
    );

    // Prompts：引导模板（V04-MCP-SERVER-SPEC §4）
    addPrompt(server, 'refine-last', {
      title: '精修上一张',
      description: '取最近一次成功生成，引导用 referenceHistoryIds 精修',
      argsSchema: {},
    }, () => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: '请调用 list_history 找到最近一次 success 的生成，向我确认精修方向后，用 generate_image 的 referenceHistoryIds 参数基于它继续生成。',
        },
      }],
    }));
  } else {
    log('[musefold-mcp] 控制面不可达，以降级目录启动（仅 musefold_status）');
  }

  return { server, connected };
}
