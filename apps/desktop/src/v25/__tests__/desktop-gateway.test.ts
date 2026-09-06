import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  accountSummarySchema,
  aiProviderModelListSchema,
  aiProviderSchema,
  aiProviderTestResultSchema,
  appInfoSchema,
  appPreferencesSchema,
  backupInfoSchema,
  clearAllDataResultSchema,
  createAiProviderSchema,
  diagnosticLogSchema,
  restoreBackupResultSchema,
  storageLocationSchema,
  createGenerationInputSchema,
  createWorkbenchSessionSchema,
  desktopSyncStatusSchema,
  doubaoAccountStatusSchema,
  generationCleanupResultSchema,
  generationHistoryPageSchema,
  generationHistoryQuerySchema,
  generationStorageUsageSchema,
  generationJobSchema,
  generationReferenceImageSchema,
  newPromptDocumentSchema,
  newPromptFolderSchema,
  newPromptTagSchema,
  promptDocumentSchema,
  promptFolderSchema,
  promptListQuerySchema,
  promptPageSchema,
  promptTagSchema,
  promptUseInputSchema,
  promptUseResultSchema,
  providerOptionSchema,
  redeemResultSchema,
  saveAssetInputSchema,
  saveAssetResultSchema,
  syncConflictListSchema,
  updateAiProviderSchema,
  updatePromptDocumentSchema,
  updatePromptFolderSchema,
  updatePromptTagSchema,
  updateWorkbenchSessionSchema,
  uploadReferenceImageInputSchema,
  workbenchSessionListQuerySchema,
  workbenchSessionPageSchema,
  workbenchSessionSchema,
} from '@musefold/contracts';
import { z } from 'zod';
import { createDesktopGateway, DesktopGatewayError } from '../desktop-gateway';

const NOW = '2026-08-29T00:00:00+00:00';
const invokeMock = vi.fn<(method: string, payload?: unknown) => Promise<unknown>>();

const preferences = appPreferencesSchema.parse({
  theme: 'system',
  language: 'zh-CN',
  reducedMotion: 'system',
  pinnedSessionIds: [],
});

const account = accountSummarySchema.parse({
  id: 'account-1',
  username: 'creator',
  displayName: null,
  quota: 100,
  quotaUnit: 'points',
  canGenerate: true,
});

const provider = aiProviderSchema.parse({
  id: 'provider-1',
  name: '本地连接',
  type: 'openai-compatible',
  baseUrl: 'https://gateway.example/v1',
  model: 'image-model',
  hasKey: false,
  keySuffix: null,
  isActive: true,
  managedBy: null,
  createdAt: NOW,
  updatedAt: NOW,
});

const tag = promptTagSchema.parse({
  id: 'tag-0001',
  name: '风格',
  group: null,
  color: null,
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
});

const folder = promptFolderSchema.parse({
  id: 'folder-1',
  name: '未整理',
  parentId: null,
  sortOrder: 0,
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
});

const prompt = promptDocumentSchema.parse({
  id: 'prompt-1',
  title: '测试提示词',
  description: null,
  content: 'a useful prompt',
  negative: null,
  folderId: null,
  tags: [tag],
  modelId: null,
  params: null,
  rating: 0,
  isPinned: false,
  pinOrder: null,
  usageCount: 0,
  lastUsedAt: null,
  source: 'manual',
  sourceUrl: null,
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
});

const session = workbenchSessionSchema.parse({
  id: 'session-1',
  title: '测试会话',
  draft: {
    prompt: '',
    negative: '',
    params: {},
    promptReferenceSelections: [],
    promptReferenceIds: [],
  },
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
  archivedAt: null,
  deletedAt: null,
  latestJobStatus: null,
  latestJobFinishedAt: null,
});

const referenceImage = generationReferenceImageSchema.parse({
  id: 'reference-1',
  url: 'media://local/?p=%2Ftmp%2Freference.png',
  name: 'reference.png',
  mimeType: 'image/png',
  byteSize: 1,
});

const job = generationJobSchema.parse({
  id: 'generation-1',
  sessionId: null,
  parentRunId: null,
  promptId: null,
  userPrompt: 'a useful prompt',
  promptReferences: [
    {
      promptId: 'prompt-1',
      title: '构图片段',
      text: 'wide composition',
      scope: 'excerpt',
      sourceVersion: 3,
    },
  ],
  actorType: 'desktop_local',
  approvalStatus: 'not_required',
  status: 'queued',
  progress: 0,
  request: {
    prompt: 'a useful prompt',
    size: 'auto',
    quality: 'auto',
    count: 1,
    referenceImages: [],
  },
  providerModel: 'image-model',
  costPoints: null,
  assets: [],
  error: null,
  createdAt: NOW,
  startedAt: null,
  finishedAt: null,
  deletedAt: null,
});

const createProvider = createAiProviderSchema.parse({
  name: provider.name,
  baseUrl: provider.baseUrl,
  model: provider.model,
  activate: false,
});
const updateProvider = updateAiProviderSchema.parse({ model: 'new-model' });
const promptQuery = promptListQuerySchema.parse({ limit: 10 });
const sessionQuery = workbenchSessionListQuerySchema.parse({ limit: 10 });
const generationQuery = generationHistoryQuerySchema.parse({ limit: 10 });
const createPrompt = newPromptDocumentSchema.parse({
  title: prompt.title,
  description: prompt.description,
  content: prompt.content,
  negative: prompt.negative,
  folderId: prompt.folderId,
  tagIds: [],
  modelId: prompt.modelId,
  params: prompt.params,
  rating: prompt.rating,
  isPinned: prompt.isPinned,
  source: prompt.source,
  sourceUrl: prompt.sourceUrl,
});
const updatePrompt = updatePromptDocumentSchema.parse({
  expectedVersion: 1,
  title: '更新后的提示词',
});
const createFolder = newPromptFolderSchema.parse({
  name: '新文件夹',
  parentId: null,
  sortOrder: 0,
});
const updateFolder = updatePromptFolderSchema.parse({ expectedVersion: 1, name: '更新后的文件夹' });
const createTag = newPromptTagSchema.parse({ name: '新标签', group: null, color: null });
const updateTag = updatePromptTagSchema.parse({ expectedVersion: 1, name: '更新后的标签' });
const createSession = createWorkbenchSessionSchema.parse({ title: session.title, draft: {} });
const updateSession = updateWorkbenchSessionSchema.parse({
  expectedVersion: 1,
  title: '更新后的会话',
});
const generationInput = createGenerationInputSchema.parse({
  prompt: 'a useful prompt',
  referenceImages: [],
  promptReferenceSelections: [
    { promptId: 'prompt-1', scope: 'full', expectedVersion: 2 },
    {
      promptId: 'prompt-2',
      scope: 'excerpt',
      expectedVersion: 4,
      range: { start: 1, end: 7 },
    },
  ],
});
const upload = uploadReferenceImageInputSchema.parse({
  name: 'reference.png',
  bytes: new Uint8Array([1]),
});
const save = saveAssetInputSchema.parse({ url: referenceImage.url, name: 'saved.png' });

const syncStatus = desktopSyncStatusSchema.parse({
  consent: 'enabled',
  phase: 'idle',
  enabled: true,
  state: 'idle',
  account: { username: account.username, deviceName: 'Musefold Desktop' },
  lastSyncedAt: NOW,
  pendingMutations: 0,
  conflicts: 1,
  error: null,
});
const syncConflicts = syncConflictListSchema.parse([
  {
    id: 'conflict-1',
    entityType: 'prompt',
    entityId: prompt.id,
    localSnapshot: { title: '本地标题', content: 'local content' },
    remoteSnapshot: prompt,
    createdAt: NOW,
    canDuplicate: true,
  },
]);

const doubaoStatus = doubaoAccountStatusSchema.parse({
  loggedIn: false,
  accountName: null,
  avatarDataUrl: null,
  verificationRequired: false,
  usage: { date: '2026-09-01', limit: 100, used: 0, remaining: 100 },
  loginState: 'qr-ready',
  qrCodeDataUrl: 'data:image/svg+xml;base64,PHN2Zy8+',
  qrExpiresAt: 1_800_000_000_000,
  errorMessage: null,
});

const backup = backupInfoSchema.parse({
  file: 'backup-20260901-101500-123-manual.db',
  size: 8192,
  createdAt: NOW,
  kind: 'manual',
});
const storageLocation = storageLocationSchema.parse({
  id: 'backups',
  label: '备份目录',
  displayPath: '/Users/creator/Library/Application Support/Musefold/musefold-backups-v0.3.0',
});
const appInfo = appInfoSchema.parse({
  version: '2.5.0',
  platform: 'darwin',
  arch: 'arm64',
  schemaVersion: 21,
  channel: 'stable',
});

const responseByMethod: Record<string, unknown> = {
  'settings.getPreferences': preferences,
  'settings.updatePreferences': preferences,
  'account.getStatus': account,
  'account.login': account,
  'account.register': account,
  'account.logout': null,
  'account.redeem': redeemResultSchema.parse({ account, creditedQuota: 10 }),
  'sync.getStatus': syncStatus,
  'sync.setConsent': syncStatus,
  'sync.listConflicts': syncConflicts,
  'sync.resolveConflict': syncStatus,
  'sync.setEnabled': syncStatus,
  'sync.syncNow': syncStatus,
  'aiProviders.list': [provider],
  'aiProviders.create': provider,
  'aiProviders.update': provider,
  'aiProviders.remove': null,
  'aiProviders.setActive': provider,
  'aiProviders.test': aiProviderTestResultSchema.parse({
    ok: true,
    message: '连接正常',
    latencyMs: 1,
  }),
  'aiProviders.listModels': aiProviderModelListSchema.parse({ models: [{ id: 'image-model' }] }),
  'agentConnections.list': [provider],
  'agentConnections.create': provider,
  'agentConnections.update': provider,
  'agentConnections.remove': null,
  'agentConnections.setActive': provider,
  'agentConnections.test': aiProviderTestResultSchema.parse({
    ok: true,
    message: '连接正常',
    latencyMs: 1,
  }),
  'agentConnections.listModels': aiProviderModelListSchema.parse({
    models: [{ id: 'image-model' }],
  }),
  'doubao.getStatus': doubaoStatus,
  'doubao.startLogin': doubaoStatus,
  'doubao.refreshLogin': doubaoStatus,
  'doubao.logout': doubaoStatus,
  'system.getAppInfo': appInfo,
  'system.listBackups': [backup],
  'system.createBackup': { backup },
  'system.restoreBackup': restoreBackupResultSchema.parse({
    safetyBackupFile: 'backup-20260901-101600-000-pre-restore.db',
    needsRestart: true,
  }),
  'system.listStorageLocations': [storageLocation],
  'system.openStorageLocation': null,
  'system.readDiagnosticLog': diagnosticLogSchema.parse({ text: 'log tail', truncated: false }),
  'system.clearAllData': clearAllDataResultSchema.parse({
    safetyBackupFile: 'backup-20260901-101700-000-pre-reset.db',
  }),
  'system.openExternal': null,
  'system.openProductDocs': null,
  'system.relaunch': null,
  'prompts.list': promptPageSchema.parse({ items: [prompt], nextCursor: null }),
  'prompts.get': prompt,
  'prompts.create': prompt,
  'prompts.update': prompt,
  'prompts.remove': prompt,
  'prompts.restore': prompt,
  'prompts.purge': undefined,
  'prompts.emptyTrash': { purged: 2 },
  'prompts.use': promptUseResultSchema.parse({ prompt, recorded: true }),
  'prompts.listFolders': [folder],
  'prompts.createFolder': folder,
  'prompts.updateFolder': folder,
  'prompts.removeFolder': folder,
  'prompts.listTags': [tag],
  'prompts.createTag': tag,
  'prompts.updateTag': tag,
  'prompts.removeTag': tag,
  'workbench.listSessions': workbenchSessionPageSchema.parse({
    items: [session],
    nextCursor: null,
  }),
  'workbench.createSession': session,
  'workbench.getSession': session,
  'workbench.updateSession': session,
  'workbench.removeSession': session,
  'workbench.restoreSession': session,
  'generation.create': job,
  'generation.list': generationHistoryPageSchema.parse({ items: [job], nextCursor: null }),
  'generation.get': job,
  'generation.cancel': job,
  'generation.retry': job,
  'generation.remove': job,
  'generation.restore': job,
  'generation.purge': undefined,
  'generation.listProviders': [
    providerOptionSchema.parse({
      id: provider.id,
      label: provider.name,
      model: provider.model,
      kind: 'local',
      available: true,
    }),
  ],
  'generation.uploadReferenceImage': referenceImage,
  'generation.saveAsset': saveAssetResultSchema.parse('saved'),
  'generation.cleanup': generationCleanupResultSchema.parse({ affected: 3 }),
  'generation.getStorageUsage': generationStorageUsageSchema.parse({
    bytes: 4096,
    fileCount: 2,
  }),
  'generation.revealAsset': undefined,
  'generation.copyAssetToClipboard': undefined,
};

function setBridge(): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { musefoldV25: { invoke: invokeMock } },
  });
}

describe('desktop gateway transport contract', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    setBridge();
    invokeMock.mockImplementation(async (method) => ({ ok: true, data: responseByMethod[method] }));
  });

  it('maps every MusefoldGateway method to its IPC name and exact payload shape', async () => {
    const gateway = createDesktopGateway();
    const sync = gateway.sync;
    const aiProviders = gateway.aiProviders;
    const agentConnections = gateway.agentConnections;
    const doubao = gateway.doubao;
    const system = gateway.system;
    if (!sync || !aiProviders || !agentConnections || !doubao || !system) {
      throw new Error('desktop gateway optional domains are missing');
    }

    await gateway.settings.getPreferences();
    await gateway.settings.updatePreferences({ theme: 'dark' });
    await gateway.account.getStatus();
    await gateway.account.login({ username: 'creator', password: 'password' });
    await gateway.account.register({ username: 'creator', password: 'password' });
    await gateway.account.logout();
    await gateway.account.redeem('redeem-code');
    await sync.getStatus();
    await sync.setConsent('enabled');
    await sync.listConflicts();
    await sync.resolveConflict('conflict-1', 'duplicate');
    await sync.setEnabled(true);
    await sync.syncNow();
    await aiProviders.list();
    await aiProviders.create(createProvider);
    await aiProviders.update(provider.id, updateProvider);
    await aiProviders.remove(provider.id);
    await aiProviders.setActive(provider.id);
    await aiProviders.test({ id: provider.id });
    await aiProviders.listModels({ id: provider.id });
    await agentConnections.list();
    await agentConnections.create(createProvider);
    await agentConnections.update(provider.id, updateProvider);
    await agentConnections.remove(provider.id);
    await agentConnections.setActive(provider.id);
    await agentConnections.test({ id: provider.id });
    await agentConnections.listModels({ id: provider.id });
    await doubao.getStatus();
    await doubao.startLogin();
    await doubao.refreshLogin();
    await doubao.logout();
    await system.getAppInfo();
    await system.listBackups();
    await system.createBackup();
    await system.restoreBackup({ file: backup.file });
    await system.listStorageLocations();
    await system.openStorageLocation({ id: 'backups' });
    await system.readDiagnosticLog();
    await system.clearAllData({ confirmation: '清空全部数据' });
    await system.openExternal({ url: 'https://ai.tvt.wiki/login/' });
    await system.openProductDocs();
    await system.relaunch();
    await gateway.prompts.list(promptQuery);
    await gateway.prompts.get(prompt.id);
    await gateway.prompts.create(createPrompt);
    await gateway.prompts.update(prompt.id, updatePrompt);
    await gateway.prompts.remove(prompt.id);
    await gateway.prompts.restore(prompt.id);
    await gateway.prompts.purge(prompt.id);
    await gateway.prompts.emptyTrash();
    await gateway.prompts.use(prompt.id, promptUseInputSchema.parse({ action: 'copy' }));
    await gateway.prompts.listFolders();
    await gateway.prompts.createFolder(createFolder);
    await gateway.prompts.updateFolder(folder.id, updateFolder);
    await gateway.prompts.removeFolder(folder.id);
    await gateway.prompts.listTags();
    await gateway.prompts.createTag(createTag);
    await gateway.prompts.updateTag(tag.id, updateTag);
    await gateway.prompts.removeTag(tag.id);
    await gateway.workbench.listSessions(sessionQuery);
    await gateway.workbench.createSession(createSession);
    await gateway.workbench.getSession(session.id);
    await gateway.workbench.updateSession(session.id, updateSession);
    await gateway.workbench.removeSession(session.id);
    await gateway.workbench.restoreSession(session.id);
    await gateway.generation.create(generationInput, 'desktop-create-intent');
    await gateway.generation.list(generationQuery);
    await gateway.generation.get(job.id);
    await gateway.generation.cancel(job.id);
    await gateway.generation.retry(job.id, 'desktop-retry-intent');
    await gateway.generation.remove(job.id);
    await gateway.generation.restore(job.id);
    await gateway.generation.purge(job.id);
    await gateway.generation.listProviders();
    await gateway.generation.uploadReferenceImage(upload);
    await gateway.generation.saveAsset(save);
    await gateway.generation.cleanup({ scope: 'older-than-30d' });
    await gateway.generation.getStorageUsage?.();
    await gateway.generation.revealAsset?.('asset-1');
    await gateway.generation.copyAssetToClipboard?.('asset-1');

    expect(invokeMock.mock.calls.map(([method, payload]) => [method, payload])).toEqual([
      ['settings.getPreferences', undefined],
      ['settings.updatePreferences', { theme: 'dark' }],
      ['account.getStatus', undefined],
      ['account.login', { username: 'creator', password: 'password' }],
      ['account.register', { username: 'creator', password: 'password' }],
      ['account.logout', undefined],
      ['account.redeem', { code: 'redeem-code' }],
      ['sync.getStatus', undefined],
      ['sync.setConsent', { consent: 'enabled' }],
      ['sync.listConflicts', undefined],
      ['sync.resolveConflict', { conflictId: 'conflict-1', resolution: 'duplicate' }],
      ['sync.setEnabled', { enabled: true }],
      ['sync.syncNow', undefined],
      ['aiProviders.list', undefined],
      ['aiProviders.create', createProvider],
      ['aiProviders.update', { id: provider.id, patch: updateProvider }],
      ['aiProviders.remove', { id: provider.id }],
      ['aiProviders.setActive', { id: provider.id }],
      ['aiProviders.test', { id: provider.id }],
      ['aiProviders.listModels', { id: provider.id }],
      ['agentConnections.list', undefined],
      ['agentConnections.create', createProvider],
      ['agentConnections.update', { id: provider.id, patch: updateProvider }],
      ['agentConnections.remove', { id: provider.id }],
      ['agentConnections.setActive', { id: provider.id }],
      ['agentConnections.test', { id: provider.id }],
      ['agentConnections.listModels', { id: provider.id }],
      ['doubao.getStatus', undefined],
      ['doubao.startLogin', undefined],
      ['doubao.refreshLogin', undefined],
      ['doubao.logout', undefined],
      ['system.getAppInfo', undefined],
      ['system.listBackups', undefined],
      ['system.createBackup', undefined],
      ['system.restoreBackup', { file: backup.file }],
      ['system.listStorageLocations', undefined],
      ['system.openStorageLocation', { id: 'backups' }],
      ['system.readDiagnosticLog', undefined],
      ['system.clearAllData', { confirmation: '清空全部数据' }],
      ['system.openExternal', { url: 'https://ai.tvt.wiki/login/' }],
      ['system.openProductDocs', undefined],
      ['system.relaunch', undefined],
      ['prompts.list', promptQuery],
      ['prompts.get', { id: prompt.id }],
      ['prompts.create', createPrompt],
      ['prompts.update', { id: prompt.id, patch: updatePrompt }],
      ['prompts.remove', { id: prompt.id }],
      ['prompts.restore', { id: prompt.id }],
      ['prompts.purge', { id: prompt.id }],
      ['prompts.emptyTrash', undefined],
      ['prompts.use', { id: prompt.id, input: { action: 'copy' } }],
      ['prompts.listFolders', undefined],
      ['prompts.createFolder', createFolder],
      ['prompts.updateFolder', { id: folder.id, patch: updateFolder }],
      ['prompts.removeFolder', { id: folder.id }],
      ['prompts.listTags', undefined],
      ['prompts.createTag', createTag],
      ['prompts.updateTag', { id: tag.id, patch: updateTag }],
      ['prompts.removeTag', { id: tag.id }],
      ['workbench.listSessions', sessionQuery],
      ['workbench.createSession', createSession],
      ['workbench.getSession', session.id],
      ['workbench.updateSession', { id: session.id, patch: updateSession }],
      ['workbench.removeSession', session.id],
      ['workbench.restoreSession', session.id],
      ['generation.create', generationInput],
      ['generation.list', generationQuery],
      ['generation.get', job.id],
      ['generation.cancel', job.id],
      ['generation.retry', job.id],
      ['generation.remove', job.id],
      ['generation.restore', job.id],
      ['generation.purge', job.id],
      ['generation.listProviders', undefined],
      ['generation.uploadReferenceImage', upload],
      ['generation.saveAsset', save],
      ['generation.cleanup', { scope: 'older-than-30d' }],
      ['generation.getStorageUsage', undefined],
      // 本机文件动作只送资产 id:渲染层不持有任何路径(ui-parity 05 §7)。
      ['generation.revealAsset', 'asset-1'],
      ['generation.copyAssetToClipboard', 'asset-1'],
    ]);
    expect(invokeMock).toHaveBeenCalledTimes(80);
  });

  it('parses successful data with the method response schema and rejects mismatches', async () => {
    const gateway = createDesktopGateway();
    await expect(gateway.account.getStatus()).resolves.toEqual(account);

    invokeMock.mockResolvedValueOnce({ ok: true, data: { ...account, quota: '100' } });
    await expect(gateway.account.getStatus()).rejects.toBeInstanceOf(z.ZodError);
  });

  it('parses renderer-safe conflicts and rejects owner identity leakage', async () => {
    const sync = createDesktopGateway().sync;
    if (!sync) throw new Error('desktop gateway sync domain is missing');

    await expect(sync.listConflicts()).resolves.toEqual(syncConflicts);
    invokeMock.mockResolvedValueOnce({
      ok: true,
      data: [{ ...syncConflicts[0], ownerId: 'owner-1' }],
    });
    await expect(sync.listConflicts()).rejects.toBeInstanceOf(z.ZodError);
  });

  it('turns a structured error envelope into DesktopGatewayError', async () => {
    const gateway = createDesktopGateway();
    invokeMock.mockResolvedValueOnce({
      ok: false,
      code: 'PROMPT_NOT_FOUND',
      message: '提示词不存在',
    });

    const error = await gateway.prompts.get(prompt.id).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(DesktopGatewayError);
    expect(error).toMatchObject({ code: 'PROMPT_NOT_FOUND', message: '提示词不存在' });
  });

  it('turns malformed bridge envelopes into a structured DesktopGatewayError', async () => {
    const gateway = createDesktopGateway();
    const malformedEnvelopes: unknown[] = [
      undefined,
      null,
      'not-an-envelope',
      42,
      [],
      { data: account },
      { ok: true },
      { ok: false },
      { ok: false, code: 'REMOTE_ERROR' },
      { ok: false, message: 'remote failure' },
    ];

    for (const envelope of malformedEnvelopes) {
      invokeMock.mockResolvedValueOnce(envelope);
      const error = await gateway.account.getStatus().catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(DesktopGatewayError);
      expect(error).toMatchObject({
        code: 'MALFORMED_ENVELOPE',
        message: '桌面桥返回格式无效',
      });
      expect(error).not.toBeInstanceOf(TypeError);
    }
  });

  it('rejects calls when the preload bridge is missing', async () => {
    vi.stubGlobal('window', {});
    const gateway = createDesktopGateway();

    await expect(gateway.settings.getPreferences()).rejects.toMatchObject({
      name: 'DesktopGatewayError',
      code: 'BRIDGE_MISSING',
      message: 'v2.5 preload 桥未注入',
    });
  });
});
