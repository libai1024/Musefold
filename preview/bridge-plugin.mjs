// preview/bridge-plugin.mjs
// DEV-ONLY 预览桥（后端）——仅由 vite.preview.config.ts 加载，绝不进入 electron 打包。
// 目的：让浏览器 UI 预览能跑通「新建服务商 → 保存密钥 → 测试连接 → 生成图片」全流程，
// 而无需 Electron 主进程/IPC。真实 app 走 preload contextBridge，与此文件无关。
//
// 契约与主进程保持一致（electron/main/ipc/*、electron/providers/openai-compatible.ts）：
//   - provider CRUD / saveKey / hasKey / validate
//   - image.generate：openai SDK → b64_json → data: URL（浏览器可直接渲染，符合 CSP img-src data:）
// 密钥仅存在于 dev server 进程内存，随进程退出即丢，不落盘、不进 git。

import OpenAI from 'openai';

const ENDPOINT = '/__preview_api__';

// ---- 进程内内存态（预览专用） ----
/** @type {Map<string, any>} providerId -> ProviderConfig */
const providers = new Map();
/** @type {Map<string, string>} providerId -> apiKey（明文，仅内存） */
const keys = new Map();
/** @type {Map<string, {mode:'per-image'|'per-1k-token', unitPoints:number}>} providerId -> pricing */
const pricing = new Map();
const previewBackups = [];
const previewPrompts = new Map();
const previewAiConnections = new Map();
const previewAiKeys = new Map();
let activeId = null;
let activeAiConnectionId = null;

const now = () => Date.now();
const rid = (p) => `${p}_${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;

function normalizePricing(raw) {
  if (!raw || (raw.mode !== 'per-image' && raw.mode !== 'per-1k-token')) {
    throw new Error('计费方式无效');
  }
  if (typeof raw.unitPoints !== 'number' || !Number.isFinite(raw.unitPoints)) {
    throw new Error('单价必须是有效积分数');
  }
  if (raw.unitPoints < 0) throw new Error('单价不能为负数');
  return { mode: raw.mode, unitPoints: raw.unitPoints };
}

function usageTokens(raw) {
  const usage = raw?.usage;
  if (!usage) return undefined;
  if (Number.isFinite(usage.total_tokens)) return usage.total_tokens;
  const input = Number.isFinite(usage.input_tokens) ? usage.input_tokens : 0;
  const output = Number.isFinite(usage.output_tokens) ? usage.output_tokens : 0;
  const total = input + output;
  return total > 0 ? total : undefined;
}

function estimateCost(providerId, req, usage) {
  const p = pricing.get(providerId);
  if (!p) return undefined;
  if (p.mode === 'per-image') return p.unitPoints * Math.max(1, Math.floor(req?.n ?? 1));
  if (!Number.isFinite(usage)) return undefined;
  return Math.round(((usage / 1000) * p.unitPoints) * 1_000_000) / 1_000_000;
}

function clientFor(providerId) {
  const p = providers.get(providerId);
  const apiKey = keys.get(providerId);
  if (!p) throw Object.assign(new Error('Provider 不存在'), { code: 'NO_PROVIDER' });
  if (!apiKey) throw Object.assign(new Error('尚未保存 API Key'), { code: 'AUTH' });
  return { client: new OpenAI({ apiKey, baseURL: p.baseUrl }), config: p };
}

function normalizeError(err) {
  const e = err || {};
  const status = e.status;
  let code = 'UNKNOWN';
  if (status === 400) code = 'BAD_REQUEST';
  else if (status === 401 || status === 403) code = 'AUTH';
  else if (status === 429) code = 'RATE_LIMIT';
  else if (status && status >= 500) code = 'SERVER';
  const message = e?.error?.message ?? e?.message ?? 'Unknown error';
  return { code, message, status };
}

// ---- 分发（channel -> handler） ----
// args 为「位置参数数组」，与 window.api.<domain>.<method>(...args) 一一对应，
// 见 packages/desktop-contracts/src/ipc.ts 的 Api 接口。返回值形态也严格对齐该契约。
async function dispatch(channel, args) {
  const [a0, a1] = args ?? [];

  switch (channel) {
    // -------- BYOK text AI (preview-only Fake AI) --------
    case 'aiConnection:listPresets':
      return [
        { id: 'deepseek', name: 'DeepSeek', routeKind: 'direct', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', hint: 'OpenAI-compatible API' },
        { id: 'kimi', name: 'Kimi', routeKind: 'direct', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', hint: 'OpenAI-compatible API' },
        { id: 'glm', name: 'GLM', routeKind: 'direct', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', hint: 'OpenAI-compatible API' },
        { id: 'minimax', name: 'MiniMax', routeKind: 'direct', baseUrl: 'https://api.minimaxi.com/v1', model: 'MiniMax-M2.1', hint: 'OpenAI-compatible API' },
        { id: 'litellm', name: 'LiteLLM', routeKind: 'gateway', baseUrl: 'http://localhost:4000/v1', model: 'default', hint: '外部网关' },
        { id: 'new-api', name: 'New API', routeKind: 'gateway', baseUrl: 'http://localhost:3000/v1', model: 'default', hint: '外部网关' },
        { id: 'custom', name: '自定义兼容接口', routeKind: 'gateway', baseUrl: 'https://example.com/v1', model: 'model-id', hint: 'OpenAI-compatible API' },
      ];

    case 'aiConnection:list':
      return [...previewAiConnections.values()];

    case 'aiConnection:create': {
      const id = rid('ai');
      const createdAt = now();
      const profile = {
        id,
        name: a0?.name ?? 'AI 连接',
        routeKind: a0?.routeKind ?? 'gateway',
        protocol: 'openai-compatible',
        presetId: a0?.presetId ?? 'custom',
        baseUrl: a0?.baseUrl ?? 'https://example.com/v1',
        model: a0?.model ?? 'model-id',
        capabilities: {
          modelDiscovery: 'unknown',
          supportedStructuredOutputModes: ['json-schema', 'json-object', 'json-text'],
          preferredStructuredOutputMode: 'json-schema',
          cancellation: true,
          streaming: false,
          lastValidatedAt: null,
        },
        hasKey: false,
        keySuffix: null,
        isActive: a0?.isActive ?? previewAiConnections.size === 0,
        createdAt,
        updatedAt: createdAt,
      };
      if (profile.isActive) {
        for (const [id0, item] of previewAiConnections) previewAiConnections.set(id0, { ...item, isActive: false });
        activeAiConnectionId = id;
      }
      previewAiConnections.set(id, profile);
      return profile;
    }

    case 'aiConnection:update': {
      const current = previewAiConnections.get(a0);
      if (!current) throw new Error('AI 连接不存在');
      const updated = { ...current, ...a1, protocol: 'openai-compatible', updatedAt: now() };
      previewAiConnections.set(a0, updated);
      return updated;
    }

    case 'aiConnection:delete':
      previewAiConnections.delete(a0);
      previewAiKeys.delete(a0);
      if (activeAiConnectionId === a0) activeAiConnectionId = null;
      return { ok: true };

    case 'aiConnection:saveKey': {
      const current = previewAiConnections.get(a0);
      if (!current) throw new Error('AI 连接不存在');
      previewAiKeys.set(a0, String(a1 ?? ''));
      const updated = { ...current, hasKey: true, keySuffix: String(a1 ?? '').slice(-4), updatedAt: now() };
      previewAiConnections.set(a0, updated);
      return updated;
    }

    case 'aiConnection:deleteKey': {
      const current = previewAiConnections.get(a0);
      if (!current) throw new Error('AI 连接不存在');
      previewAiKeys.delete(a0);
      const updated = { ...current, hasKey: false, keySuffix: null, updatedAt: now() };
      previewAiConnections.set(a0, updated);
      return updated;
    }

    case 'aiConnection:hasKey': {
      const current = previewAiConnections.get(a0);
      return { hasKey: previewAiKeys.has(a0), suffix: current?.keySuffix ?? null };
    }

    case 'aiConnection:setActive': {
      if (!previewAiConnections.has(a0)) throw new Error('AI 连接不存在');
      for (const [id, item] of previewAiConnections) {
        previewAiConnections.set(id, { ...item, isActive: id === a0 });
      }
      activeAiConnectionId = a0;
      return previewAiConnections.get(a0);
    }

    case 'aiConnection:listModels':
      if (!previewAiConnections.has(a0)) throw new Error('AI 连接不存在');
      return [{ id: 'preview-text-model', name: 'preview-text-model', ownedBy: 'Musefold Fake AI' }];

    case 'aiConnection:validate': {
      const current = previewAiConnections.get(a0);
      if (!current) throw new Error('AI 连接不存在');
      if (!previewAiKeys.has(a0)) {
        return { ok: false, message: '尚未配置 API Key', models: [], capabilities: current.capabilities };
      }
      const capabilities = { ...current.capabilities, modelDiscovery: 'available', lastValidatedAt: now() };
      previewAiConnections.set(a0, { ...current, capabilities });
      return {
        ok: true,
        message: 'Fake AI 连接成功，共发现 1 个模型',
        models: [{ id: 'preview-text-model', name: 'preview-text-model', ownedBy: 'Musefold Fake AI' }],
        capabilities,
      };
    }

    // -------- provider --------
    case 'provider:list':
      return [...providers.values()];

    case 'provider:create': {
      // a0: NewProviderConfig
      const id = rid('prov');
      const cfg = {
        id,
        name: a0?.name ?? '未命名服务商',
        type: a0?.type ?? 'openai-compatible',
        baseUrl: a0?.baseUrl ?? '',
        model: a0?.model ?? '',
        hasKey: false,
        keySuffix: null,
        isActive: a0?.isActive ?? providers.size === 0,
        createdAt: now(),
        updatedAt: now(),
      };
      providers.set(id, cfg);
      if (cfg.isActive) {
        for (const [pid, p] of providers) providers.set(pid, { ...p, isActive: pid === id });
        activeId = id;
      }
      return cfg;
    }

    case 'provider:update': {
      // a0: id, a1: Partial<NewProviderConfig>
      const cur = providers.get(a0);
      if (!cur) throw Object.assign(new Error('Provider 不存在'), { code: 'NO_PROVIDER' });
      const next = { ...cur, ...a1, updatedAt: now() };
      providers.set(cur.id, next);
      return next;
    }

    case 'provider:listModels': {
      const cur = providers.get(a0);
      if (!cur) throw Object.assign(new Error('Provider 不存在'), { code: 'NO_PROVIDER' });
      if (cur.type === 'openai' || cur.type === 'openai-compatible') {
        return [
          { id: 'gpt-image-2', name: 'gpt-image-2', description: 'OpenAI 最新图像生成模型' },
          { id: 'gpt-image-1', name: 'gpt-image-1', description: 'OpenAI 图像生成模型 v1' },
        ];
      }
      return [{ id: cur.model, name: cur.model, description: '当前配置产品' }];
    }

    case 'provider:delete': {
      // a0: id
      providers.delete(a0);
      keys.delete(a0);
      pricing.delete(a0);
      if (activeId === a0) activeId = providers.keys().next().value ?? null;
      return { ok: true };
    }

    case 'provider:saveKey': {
      // a0: id, a1: apiKey
      const cur = providers.get(a0);
      if (!cur) throw Object.assign(new Error('Provider 不存在'), { code: 'NO_PROVIDER' });
      keys.set(a0, a1);
      const suffix = String(a1).slice(-4);
      providers.set(a0, { ...cur, hasKey: true, keySuffix: suffix, updatedAt: now() });
      return { ok: true };
    }

    case 'provider:hasKey': {
      // a0: id -> { hasKey, suffix }
      const cur = providers.get(a0);
      return { hasKey: keys.has(a0), suffix: cur?.keySuffix ?? null };
    }

    case 'provider:setActive': {
      // a0: id
      if (!providers.has(a0)) throw new Error('Provider 不存在');
      for (const [id, p] of providers) providers.set(id, { ...p, isActive: id === a0 });
      activeId = a0;
      return { ok: true };
    }

    case 'provider:validate': {
      // a0: id -> ValidationResult { ok, message, models? }
      try {
        const { client, config } = clientFor(a0);
        const list = await client.models.list();
        const models = (list.data ?? []).map((m) => ({ id: m.id, name: m.id }));
        const ids = models.map((m) => m.id);
        const modelOk = config.model ? ids.includes(config.model) : true;
        return {
          ok: true,
          message: modelOk
            ? `连接成功，共 ${ids.length} 个模型`
            : `连接成功，但未在模型列表中找到 ${config.model}（部分网关不列出图像模型，通常仍可生成）`,
          models,
        };
      } catch (err) {
        const e = normalizeError(err);
        return { ok: false, message: `${e.code}: ${e.message}` };
      }
    }

    // -------- settings.pricing --------
    case 'settings:pricing:get':
      if (!providers.has(a0)) throw new Error('Provider 不存在');
      return pricing.get(a0) ?? null;

    case 'settings:pricing:set': {
      if (!providers.has(a0?.providerId)) throw new Error('Provider 不存在');
      const value = normalizePricing(a0);
      pricing.set(a0.providerId, value);
      return { ok: true, pricing: value };
    }

    case 'settings:pricing:delete':
      if (!providers.has(a0)) throw new Error('Provider 不存在');
      pricing.delete(a0);
      return { ok: true };

    // -------- image --------
    case 'image:pickLocal':
      return { ok: true, image: null };

    case 'image:stageLocal': {
      const sizeBytes = a0?.bytes?.byteLength ?? a0?.bytes?.length ?? Object.keys(a0?.bytes ?? {}).length;
      // 对齐真实契约（PickLocalImagesResult.images 数组）；path 用 data: URL，
      // toImageSrc 直通渲染，预览环境没有真实文件系统。
      const staged = {
        path: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="64" height="64"%3E%3Crect width="64" height="64" rx="8" fill="%23d6653f"/%3E%3C/svg%3E',
        source: 'upload',
        name: a0?.name || 'reference.png',
        mimeType: a0?.mimeType || 'image/png',
        sizeBytes,
      };
      return { ok: true, images: [staged] };
    }

    case 'image:generate': {
      // a0: GenerateImageRequest -> GenerateImageResult
      const {
        jobId,
        providerId,
        prompt,
        model,
        size = '1024x1024',
        quality = 'auto',
      } = a0 ?? {};
      const started = now();
      try {
        const { client, config } = clientFor(providerId ?? activeId);
        const res = await client.images.generate({
          model: model || config.model || 'gpt-image-2',
          prompt,
          size: size === 'auto' ? undefined : size,
          n: 1,
        });
        const b64 = res.data?.[0]?.b64_json;
        if (!b64) throw new Error('返回中缺少 b64_json 图像数据');
        const costPoints = estimateCost(providerId ?? activeId, a0, usageTokens(res));
        return {
          historyId: jobId ?? rid('hist'),
          status: 'success',
          imagePath: `data:image/png;base64,${b64}`,
          cost: costPoints,
          costPoints,
          costUnit: 'point',
          durationMs: now() - started,
        };
      } catch (err) {
        const e = normalizeError(err);
        return {
          historyId: jobId ?? rid('hist'),
          status: 'failed',
          error: { code: e.code, message: e.message },
          durationMs: now() - started,
        };
      }
    }

    case 'image:cancel':
    case 'image:retry':
      return { ok: true };

    // -------- system（浏览器预览的内存桩） --------
    case 'system:getPaths':
      return {
        userData: 'Preview/UserData',
        pictures: 'Preview/Pictures',
        backups: 'Preview/Backups',
        logs: 'Preview/musefold-logs-v0.3.0',
      };

    case 'system:getVersion':
      return { app: '0.3.0-dev', db: 1 };

    case 'system:readClipboardText':
      return '';

    case 'history:related':
      return { items: [], total: 0 };

    case 'history:linkPrompt':
      return { linked: a0?.historyIds?.length ?? 0, alreadyLinked: 0, conflicts: [], missing: [] };

    case 'system:openAboutResource':
      if (a0 !== 'product-docs') throw new Error('ABOUT_RESOURCE_FORBIDDEN: 不允许打开该资源');
      return { ok: true };

    case 'system:listBackups':
      return previewBackups;

    case 'system:backupNow': {
      const createdAt = now();
      const file = `backup-${createdAt}-manual.db`;
      const info = { file, path: `Preview/Backups/${file}`, size: 262144, createdAt, kind: 'manual' };
      previewBackups.unshift(info);
      return { path: info.path };
    }

    case 'system:restoreBackup':
      if (!previewBackups.some((backup) => backup.file === a0?.file)) throw new Error('备份不存在');
      return { ok: true, needsRestart: true, safetyBackupPath: 'Preview/Backups/pre-restore.db' };

    case 'system:relaunch':
    case 'system:openInFolder':
      return { ok: true };

    case 'system:saveImages':
      return { cancelled: true };

    case 'system:diskUsage':
      return { imagesBytes: 0, imagesCount: 0, dir: 'Preview/Pictures' };

    case 'system:resetData': {
      if (a0?.confirm !== 'RESET') throw new Error('CONFIRMATION_REQUIRED: 清空确认无效');
      const createdAt = now();
      const file = `backup-${createdAt}-pre-reset.db`;
      const info = { file, path: `Preview/Backups/${file}`, size: 262144, createdAt, kind: 'auto' };
      previewBackups.unshift(info);
      return { ok: true, backupPath: info.path };
    }

    case 'workbenchSession:ensure':
      return {
        id: a0.id,
        title: a0.title,
        createdAt: a0.createdAt ?? now(),
        updatedAt: a0.createdAt ?? now(),
        archivedAt: null,
        deletedAt: null,
      };

    case 'workbenchSession:list':
      return { items: [], total: 0 };

    // -------- 提示词（最小实现：笺匣 / 素笺验证用）--------
    // 真实 preload 映射到 db:prompts:*，预览域代理机械映射为 prompt:*，两组都接。
    case 'db:prompts:list':
    case 'prompt:list': {
      let list = [...previewPrompts.values()].filter((p) => !p.deletedAt);
      if (a0?.filters?.source) list = list.filter((p) => p.source === a0.filters.source);
      if (a0?.search) {
        const needle = String(a0.search).toLowerCase();
        list = list.filter(
          (p) => p.title.toLowerCase().includes(needle) || p.content.toLowerCase().includes(needle),
        );
      }
      return list.sort((x, y) => y.updatedAt - x.updatedAt);
    }

    case 'db:prompts:get':
    case 'prompt:get':
      return previewPrompts.get(a0) ?? null;

    case 'db:prompts:create':
    case 'prompt:create': {
      const id = rid('prompt');
      const ts = now();
      const prompt = {
        id,
        title: a0?.title ?? '未命名',
        description: a0?.description ?? null,
        content: a0?.content ?? '',
        contentNegative: a0?.contentNegative ?? null,
        folderId: a0?.folderId ?? null,
        modelId: a0?.modelId ?? null,
        params: a0?.params ?? null,
        previewImagePath: a0?.previewImagePath ?? null,
        coverImagePath: a0?.previewImagePath ?? null,
        rating: a0?.rating ?? 0,
        isPinned: false,
        pinOrder: null,
        usageCount: 0,
        lastUsedAt: null,
        source: a0?.source ?? 'manual',
        sourceUrl: a0?.sourceUrl ?? null,
        tags: [],
        createdAt: ts,
        updatedAt: ts,
        deletedAt: null,
      };
      previewPrompts.set(id, prompt);
      return prompt;
    }

    case 'db:prompts:update':
    case 'prompt:update': {
      const current = previewPrompts.get(a0);
      if (!current) throw new Error('提示词不存在');
      const patch = Object.fromEntries(Object.entries(a1 ?? {}).filter(([, value]) => value !== undefined));
      const updated = { ...current, ...patch, updatedAt: now() };
      previewPrompts.set(a0, updated);
      return updated;
    }

    case 'db:prompts:delete':
    case 'prompt:delete': {
      const current = previewPrompts.get(a0);
      if (current) previewPrompts.set(a0, { ...current, deletedAt: now() });
      return true;
    }

    // -------- 其它域：预览下给出安全默认值，避免 UI 启动即崩 --------
    default:
      if (channel.endsWith(':list')) return [];
      return null;
  }
}

/** Vite 插件：仅预览时挂载 POST /__preview_api__，并把前端桥注入为 <head> 首个 module */
export function previewApiBridge() {
  return {
    name: 'preview-api-bridge',
    // 把 install-bridge 注入 <head> 顶部：module 脚本按文档顺序执行，
    // head 里的它会先于 body 的 main.tsx 运行，保证 src/lib/ipc.ts 求值时 window.api 已就位。
    transformIndexHtml() {
      return [
        {
          tag: 'script',
          attrs: { type: 'module', src: '/preview/install-bridge.ts' },
          injectTo: 'head-prepend',
        },
      ];
    },
    configureServer(server) {
      server.middlewares.use(ENDPOINT, async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method Not Allowed');
          return;
        }
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', async () => {
          res.setHeader('Content-Type', 'application/json');
          try {
            const { channel, args } = JSON.parse(raw || '{}');
            const result = await dispatch(channel, args);
            res.end(JSON.stringify({ ok: true, result }));
          } catch (err) {
            res.statusCode = 200; // 让前端拿到结构化错误，而非网络异常
            res.end(
              JSON.stringify({ ok: false, error: normalizeError(err) }),
            );
          }
        });
      });
      // 控制台提示，便于确认预览桥已挂载
      server.config.logger.info('  [36m➜  preview-api-bridge[0m mounted at POST /__preview_api__');
    },
  };
}

export default previewApiBridge;
