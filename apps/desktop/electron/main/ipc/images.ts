// electron/main/ipc/images.ts
// 生图 IPC 壳 —— 生成汇聚点已迁入 @musefold/core/services/generation（V04-CORE-05）；
// 本文件保留 Electron 专属部分：文件选择对话框、IPC 注册、retry 请求重建。

import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron';
import { IPC } from '@shared/types/ipc';
import { MAX_REFERENCE_IMAGES } from '@shared/types/providers';
import type {
  GenerateImageRequest,
  LocalImageReference,
  StageLocalImageInput,
} from '@shared/types/providers';
import type { ImageSize, ImageQuality, ImageBackground, ModerationLevel } from '@shared/types/enums';
import { getDb } from '@musefold/core/db/index';
import { parseJsonColumn } from '@musefold/core/db/json';
import {
  cancelGeneration,
  generate as coreGenerate,
  hasActiveImageJobs,
} from '@musefold/core/services/generation';
import { createLogger } from '../../system/logger';
import {
  pickImageFailure,
  stageLocalImage,
  stageLocalImageBytes,
} from '@musefold/core/providers/local-image';
import { notifyGenerationPending, trackPetGeneration } from '../pet';

const logger = createLogger('image');

// 生成结束后节流刷新账号余额：托管扣费发生在服务器侧，本地要拉一次真值
// 侧栏余额才会跟上。批量出图共用一次刷新；未登录时零开销直接返回。
// 动态 import 避免把 account 模块拖进单测的模块加载链。
let accountQuotaRefreshTimer: NodeJS.Timeout | null = null;

function scheduleAccountQuotaRefresh(): void {
  if (accountQuotaRefreshTimer) return;
  accountQuotaRefreshTimer = setTimeout(() => {
    accountQuotaRefreshTimer = null;
    void (async () => {
      const { getAccountService } = await import('../../account');
      const service = getAccountService();
      if (!service.status().loggedIn) return;
      await service.refreshQuota();
    })().catch(() => {
      // 余额刷新是增强项：失败时保留缓存值，下次进入账号页/看板会再拉。
    });
  }, 1500);
}

/**
 * Electron 侧生图的统一门面。
 *
 * 桌宠追踪加在这里，而不是加在各个调用点上：core 的 generate 有四条入口
 * （创作台 IPC、Skill 运行时、设计方案批跑、外部 Agent），逐个去包必然会漏。
 * 除 automation 之外的三条最终都落到这个函数，改门面就一次覆盖到位。
 *
 * 追踪本身不进 core —— 桌宠是 Electron 侧的表现层设施，core 不该知道它存在。
 * 账号余额刷新同理：所有生图入口结束后统一在这里触发一次节流拉取。
 */
export function generate(
  ...args: Parameters<typeof coreGenerate>
): ReturnType<typeof coreGenerate> {
  const job = trackPetGeneration(() => coreGenerate(...args));
  job.then(
    () => scheduleAccountQuotaRefresh(),
    () => scheduleAccountQuotaRefresh(),
  );
  return job;
}

// 兼容既有消费方（design-scheme run-session 等）
export { hasActiveImageJobs };

interface HistoryRow {
  prompt_id: string | null;
  provider_id: string;
  model: string;
  prompt_text: string;
  negative_text: string | null;
  params: string | null;
}


interface HistoryPromptReferenceRow {
  prompt_id: string | null;
  prompt_title: string;
  excerpt: string;
  scope: 'full' | 'excerpt';
}

export function registerImageHandlers(): void {
  ipcMain.handle(IPC.IMAGE_PICK_LOCAL, async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: '加入参考图',
      properties: ['openFile', 'multiSelections'] as const,
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return { ok: true as const, images: [] };
    try {
      const images: LocalImageReference[] = [];
      for (const path of result.filePaths.slice(0, MAX_REFERENCE_IMAGES)) {
        images.push(await stageLocalImage(path));
      }
      return { ok: true as const, images };
    } catch (error) {
      return pickImageFailure(error);
    }
  });

  ipcMain.handle(IPC.IMAGE_STAGE_LOCAL, async (_event, input: StageLocalImageInput) => {
    try {
      return { ok: true as const, images: [await stageLocalImageBytes(input)] };
    } catch (error) {
      return pickImageFailure(error);
    }
  });

  ipcMain.handle(IPC.IMAGE_GENERATE, async (event, req: GenerateImageRequest) => {
    notifyGenerationPending();
    return generate(req, (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send(IPC.IMAGE_PROGRESS, progress);
    });
  });

  ipcMain.handle(IPC.IMAGE_CANCEL, (_e, jobId: string) => {
    cancelGeneration(jobId);
    return { ok: true as const };
  });

  ipcMain.handle(IPC.IMAGE_RETRY, async (event, historyId: string, jobId?: string) => {
    const db = getDb();
    const row = db.prepare('SELECT * FROM history WHERE id = ?').get(historyId) as HistoryRow | undefined;
    if (!row) {
      // **返回而不 throw**，和 generate() 同理：ipcRenderer.invoke 只把 message 带过桥，
      // 自定义的 code 字段全丢，渲染层拿到的是
      // "Error invoking remote method 'image:retry': Error: 历史记录不存在" ——
      // 没法分类、也没法直接给用户看。这里保持结构化。
      logger.error('retry 失败', `history=${historyId}`, 'code=NO_HISTORY');
      return {
        historyId,
        status: 'failed' as const,
        error: { code: 'NO_HISTORY', message: '这条历史记录已不存在，无法重试' },
      };
    }

    // params 兜底解析：这一列理论上只由本应用写入，但导入功能让「文件里的字符串」
    // 也成了写入源。裸 JSON.parse 抛出来的又是上面那种不可读的桥错误，
    // 所以坏参数降级成空对象照常重试，而不是让整次重试崩掉。
    let params: Record<string, unknown> = {};
    if (row.params) {
      try {
        const parsed: unknown = JSON.parse(row.params);
        if (parsed && typeof parsed === 'object') params = parsed as Record<string, unknown>;
      } catch {
        logger.warn('retry 的历史参数无法解析，改用默认值', `history=${historyId}`);
      }
    }
    const promptReferences = (
      db.prepare(
        `SELECT prompt_id, prompt_title, excerpt, scope
         FROM history_prompt_references
         WHERE history_id = ?
         ORDER BY sort_order`,
      ).all(historyId) as HistoryPromptReferenceRow[]
    ).map((reference) => ({
      promptId: reference.prompt_id ?? '',
      title: reference.prompt_title,
      text: reference.excerpt,
      scope: reference.scope,
    }));
    const req: GenerateImageRequest = {
      // 渲染进程传来的 jobId 让重试也能被取消；重试始终写**新的** history 行，
      // 不覆盖原记录（GEN-11：从历史重试产生新行）
      jobId,
      providerId: row.provider_id,
      model: row.model,
      prompt: row.prompt_text,
      negative: row.negative_text ?? undefined,
      size: (params.size as ImageSize) ?? '1024x1024',
      aspectRatio: params.aspectRatio as string | undefined,
      quality: (params.quality as ImageQuality) ?? 'auto',
      n: (params.n as number) ?? 1,
      background: params.background as ImageBackground | undefined,
      moderation: params.moderation as ModerationLevel | undefined,
      promptId: row.prompt_id ?? undefined,
      parentHistoryId:
        typeof params.parentHistoryId === 'string' && params.parentHistoryId
          ? params.parentHistoryId
          : undefined,
      sourceAssetId:
        typeof params.sourceAssetId === 'string' && params.sourceAssetId
          ? params.sourceAssetId
          : undefined,
      refinementInstruction:
        typeof params.refinementInstruction === 'string' && params.refinementInstruction
          ? params.refinementInstruction
          : undefined,
      referenceImages: Array.isArray(params.referenceImages)
        ? params.referenceImages as LocalImageReference[]
        : undefined,
      promptReferences,
      skillRuntime: params.skillRuntime && typeof params.skillRuntime === 'object'
        ? params.skillRuntime as GenerateImageRequest['skillRuntime']
        : undefined,
    };
    return generate(req, (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send(IPC.IMAGE_PROGRESS, progress);
    }, { retryOfRunId: historyId });
  });
}
