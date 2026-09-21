// 控制面生命周期（V04-API-01/02 的 Electron 宿主接线）。
// whenReady 后按设置启动；before-quit 停止并删除发现文件。
// 端点诊断：内存环（最近 200 条）+ 有界 NDJSON 轮转；费用审计独立完整落库。

import { realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
import { app, BrowserWindow, Notification } from 'electron';
import {
  AutomationError,
  createAutomationServer,
  createGenerationGate,
  createV1ReadRoutes,
  CONFIRMATION_TIMEOUT_MS,
  type AuditRecord,
  type AutomationRouteHandler,
  type AutomationServer,
  type ConfirmationSummary,
  type GenerationGate,
  type GenerationHost,
  type GenerationBudget,
} from '@musefold/automation-server';
import { createLocalRoutes } from '@musefold/automation-server';
import { createExternalRunRoutes } from './automation-runs';
import { wrapDurableExternalRunRoutes } from './automation-durable-runs';
import { createElectronLocalAdminOps } from './automation-local';
import { createElectronAutomationSetupRoutes } from './automation-setup';
import { CoreError } from '@musefold/core';
import { getDb } from '@musefold/core/db/index';
import { hasManagedSpendCheckpoint } from '@musefold/core/db/repositories/managed-spend-scope';
import { ManagedExecutionError } from '@musefold/core/db/repositories/managed-execution';
import {
  LegacyManagedSpendBarrier,
  legacyManagedSpendBarrier,
} from '../system/legacy-managed-spend';
import { createSpendAuditService } from '@musefold/core/services/audit';
import { stageLocalImageBytes } from '@musefold/core/providers/local-image';
import {
  createLocalUploadOwner,
  type LocalUploadOwner,
} from '@musefold/core/services/local-upload-owner';
import { trackPetGeneration } from './pet';
import type {
  AutomationAuditEntry,
  AutomationSpendAudit,
  AutomationStatus,
} from '@musefold/desktop-contracts/ipc';
import { createLogger } from '../system/logger';
import { createAutomationRequestLog } from '../system/automation-request-log';
import { getPaths } from '../system/paths';
import { estimateProviderCost } from '../settings/pricing';
import {
  getAutomationEnabled,
  remainingAutomationBudgetPoints,
  setAutomationEnabled,
  settleAutomationBudget,
} from '../settings/automation';
import { getCoreEventHub, getMusefoldCore } from './core-instance';
import { getMainWindow } from './window';
import { createDesktopGenerationPersistence, releaseTerminalReferences } from './automation-spend';

const AUDIT_RING_LIMIT = 200;

const logger = createLogger('automation');
const auditWriter = createAutomationRequestLog({
  directory: () => getPaths().logs,
  onProblem: (problem) => {
    if (problem === 'recovered') {
      logger.info('端点请求日志已恢复写入');
      return;
    }
    const messages = {
      record_rejected: '端点请求日志超过单条容量，本条诊断未保存',
      queue_full: '端点请求日志队列已满，部分诊断未保存',
      write_failed: '端点请求日志写入失败，后续请求将重试写入',
    };
    logger.warn(messages[problem]);
  },
});
const auditRing: AutomationAuditEntry[] = [];
let server: AutomationServer | null = null;
let automationUploads: LocalUploadOwner | null = null;
let gate: GenerationGate | null = null;
let unsubscribeEvents: (() => void) | null = null;
/** 宿主注入的额外路由（P3 方案/Skill 运行）。启动前注册。 */
const hostRoutes: Record<string, AutomationRouteHandler> = {};
/** 渲染层确认卡的挂起回执：confirmationId → settle */
const rendererConfirmations = new Map<
  string,
  { expiresAt: number; resolve: (approved: boolean) => void }
>();

/** 三个本地 Agent 花费入口共用；未知费用直到核对前不能再次走自动预算。 */
export function createAutomationSpendBudget(
  admission = new LegacyManagedSpendBarrier(),
  assertAdmission: () => void = () => {},
): GenerationBudget {
  const reserved = new Map<symbol, number | null>();
  let unresolved = false;
  return {
    remainingPoints: () => {
      if (unresolved || [...reserved.values()].includes(null)) return 0;
      const inFlight = [...reserved.values()].reduce<number>(
        (sum, points) => sum + (points ?? 0),
        0,
      );
      return Math.max(0, remainingAutomationBudgetPoints() - inFlight);
    },
    settle: settleAutomationBudget,
    reserve: (estimatedPoints) => {
      assertAdmission();
      const release = admission.reserve();
      const key = Symbol('spend');
      reserved.set(key, estimatedPoints);
      let completion: Promise<void> | undefined;
      return (actualPoints) => {
        if (completion) return completion;
        completion = (async () => {
          if (actualPoints == null || !Number.isFinite(actualPoints) || actualPoints < 0) {
            unresolved = true;
            return;
          }
          try {
            await settleAutomationBudget(actualPoints);
          } catch {
            unresolved = true;
            logger.error('自动化预算冲销失败，后续花费需要逐次确认');
            return;
          }
          reserved.delete(key);
          release();
        })();
        return completion;
      };
    },
  };
}

const spendBudget = createAutomationSpendBudget(legacyManagedSpendBarrier, () => {
  if (hasManagedSpendCheckpoint(getDb()))
    throw new ManagedExecutionError('MANAGED_LEGACY_ADMISSION_CLOSED');
});

export function registerAutomationRoutes(routes: Record<string, AutomationRouteHandler>): void {
  Object.assign(hostRoutes, routes);
}

function broadcastToWindows(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
}

/** 路径白名单（V04-SECURITY §5）：realpath 后前缀匹配受管目录，symlink 穿越直接拒。 */
function isAllowedReferencePath(path: string): boolean {
  const roots = [join(getPaths().previews, 'uploads'), getPaths().pictures];
  let canonical: string;
  try {
    canonical = realpathSync(resolve(path));
  } catch {
    return false; // 文件不存在也视为不允许
  }
  return roots.some((root) => {
    let canonicalRoot: string;
    try {
      canonicalRoot = realpathSync(root);
    } catch {
      return false;
    }
    return canonical === canonicalRoot || canonical.startsWith(canonicalRoot + sep);
  });
}

function estimatePointsFromRow(row: Record<string, unknown>, n: number): number | null {
  return estimateProviderCost(row.id as string, { n });
}

/** App 确认卡流程（生图闸门与方案/Skill 运行共用）。 */
function requestRendererConfirmation(summary: ConfirmationSummary): Promise<'approved' | 'denied'> {
  const window = getMainWindow();
  if (!window || window.isDestroyed()) return Promise.resolve('denied');
  return new Promise((resolvePromise) => {
    const finish = (approved: boolean) => {
      rendererConfirmations.delete(summary.confirmationId);
      window.removeListener('closed', onClosed);
      resolvePromise(approved ? 'approved' : 'denied');
    };
    const onClosed = () => finish(false);
    rendererConfirmations.set(summary.confirmationId, {
      expiresAt: Date.now() + CONFIRMATION_TIMEOUT_MS,
      resolve: finish,
    });
    window.once('closed', onClosed);
    broadcastToWindows('automation:confirmationRequired', summary);
    if (Notification.isSupported()) {
      const points = summary.estimatedPoints;
      new Notification({
        title: 'Musefold 生成确认',
        body: `外部 Agent 请求生成 ${summary.n} 张图${points != null ? `（预估 ${points} 积分）` : '（成本未知）'}，请在应用内确认`,
      }).show();
    }
  });
}

/** Electron 宿主的生图闸门实现（App 确认卡 + 系统通知 + 预算存储）。 */
function createElectronGenerationHost(uploadOwner: LocalUploadOwner): GenerationHost {
  const core = getMusefoldCore();
  const durable = createDesktopGenerationPersistence(isAllowedReferencePath, {
    // 请求终态后归还控制面持有的上传写租约；是否真删仍由清理器的冻结/在途引用复查裁决。
    onTerminal: (request) => releaseTerminalReferences(uploadOwner, request),
  });
  return {
    // 外部 Agent 触发的生成不经过 ipc/images 的门面，桌宠追踪要在这里单独接上
    run: (req, onProgress, spendRequest) =>
      trackPetGeneration(() =>
        durable && spendRequest
          ? durable.run(req, onProgress, spendRequest)
          : core.generation.generate(req, onProgress),
      ),
    persistence: durable?.persistence,
    cancel: (jobId) => core.generation.cancel(jobId),
    estimate(body) {
      const db = getDb();
      const row = (
        body.providerId
          ? db.prepare('SELECT * FROM providers WHERE id = ?').get(body.providerId)
          : db.prepare('SELECT * FROM providers WHERE is_active = 1 LIMIT 1').get()
      ) as Record<string, unknown> | undefined;
      if (!row) {
        throw new CoreError(
          'INVALID_STATE',
          body.providerId ? '指定的 Provider 不存在' : '没有激活的图像 Provider',
          {
            providerId: body.providerId ?? null,
          },
        );
      }
      const n = body.n ?? 1;
      return {
        points: estimatePointsFromRow(row, n),
        managedByAccount: row.managed_by === 'account',
        providerId: row.id as string,
        providerName: row.name as string,
        model: body.model ?? (row.model as string),
        n,
      };
    },
    budget: spendBudget,
    requestConfirmation: (summary) => requestRendererConfirmation(summary),
    authorizeReferencePath: isAllowedReferencePath,
    stageUpload: (bytes, name, mimeType) =>
      stageLocalImageBytes(
        {
          bytes,
          name,
          mimeType: mimeType as 'image/png' | 'image/jpeg' | 'image/webp',
        },
        uploadOwner,
      ),
    resolveHistoryImage(historyId) {
      // 单账本:按运行 id 取首张可用资产(旧 history.image_path 的等价物)。
      const row = getDb()
        .prepare(
          `SELECT media_path FROM generated_assets
         WHERE run_id = ? AND status = 'available' AND media_path IS NOT NULL
         ORDER BY position LIMIT 1`,
        )
        .get(historyId) as { media_path: string | null } | undefined;
      return row?.media_path ? { path: row.media_path } : null;
    },
  };
}

/** App 确认卡回执（IPC 侧）：同时回执给闸门与渲染层挂起项（外部运行只在后者）。 */
export function resolveAutomationConfirmation(confirmationId: string, approved: boolean): boolean {
  if (gate?.pendingConfirmations().some((entry) => entry.confirmationId === confirmationId)) {
    return gate.resolveConfirmation(confirmationId, approved);
  }
  const entry = rendererConfirmations.get(confirmationId);
  if (!entry) return false;
  const expired = Date.now() >= entry.expiresAt;
  entry.resolve(expired ? false : approved);
  return !expired;
}

function recordAudit(record: AuditRecord): void {
  const entry: AutomationAuditEntry = {
    at: record.at,
    method: record.method,
    path: record.path,
    status: record.status,
    durationMs: record.durationMs,
    ...(record.errorCode ? { errorCode: record.errorCode } : {}),
  };
  auditRing.push(entry);
  if (auditRing.length > AUDIT_RING_LIMIT) auditRing.splice(0, auditRing.length - AUDIT_RING_LIMIT);
  void auditWriter.append(entry);
}

/** 方案/Skill 路由已判定需要确认；本函数只负责一次用户回执（120s 超时）。 */
async function authorizeExternalSpend(summary: {
  providerName: string;
  model: string;
  n: number;
  estimatedPoints: number | null;
  managedByAccount: boolean;
  promptPreview: string;
  confirmationId?: string;
  confirmationExpiresAt?: number;
}): Promise<void> {
  const {
    managedByAccount: _managedByAccount,
    confirmationExpiresAt,
    ...confirmationSummary
  } = summary;
  const confirmation: ConfirmationSummary = {
    confirmationId: summary.confirmationId ?? randomUUID(),
    ...confirmationSummary,
  };
  const expiresAt = confirmationExpiresAt ?? Date.now() + CONFIRMATION_TIMEOUT_MS;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  // 先注册回执，再通知 UI，避免同步回执早于 pending 登记。
  const response = requestRendererConfirmation(confirmation);
  getCoreEventHub().sink.emit({ type: 'confirmation.required', payload: confirmation });
  let verdict: 'approved' | 'denied' | 'timeout';
  try {
    verdict = await Promise.race([
      response,
      new Promise<'timeout'>((resolve) => {
        timeout = setTimeout(() => resolve('timeout'), Math.max(0, expiresAt - Date.now()));
      }),
    ]);
    if (Date.now() >= expiresAt) verdict = 'timeout';
  } finally {
    clearTimeout(timeout);
    rendererConfirmations.get(confirmation.confirmationId)?.resolve(false);
  }
  getCoreEventHub().sink.emit({
    type: 'confirmation.resolved',
    payload: { confirmationId: confirmation.confirmationId, outcome: verdict },
  });
  if (verdict === 'timeout') {
    throw new AutomationError('CONFIRMATION_TIMEOUT', '等待确认超时（120s），本次运行未执行', 409);
  }
  if (verdict === 'denied') {
    throw new AutomationError('CONFIRMATION_DENIED', '用户拒绝了本次运行', 403);
  }
}

export async function startAutomationServer(): Promise<void> {
  if (server?.listening) return;
  const core = getMusefoldCore();
  const hub = getCoreEventHub();
  const spendAudit = createSpendAuditService();
  const uploadOwner = createLocalUploadOwner();
  automationUploads = uploadOwner;
  gate = createGenerationGate(createElectronGenerationHost(uploadOwner), hub, {
    onSpendAudit: (entry) => spendAudit.record({ ...entry, caller: 'http' }),
  });
  // 确认事件转发给渲染层（卡片被 HTTP 回执/超时解决时同步关闭）
  unsubscribeEvents = hub.subscribe((event) => {
    if (event.type === 'confirmation.resolved') {
      const payload = event.payload as { confirmationId?: string };
      if (payload.confirmationId) rendererConfirmations.get(payload.confirmationId)?.resolve(false);
      broadcastToWindows('automation:confirmationResolved', event.payload);
    }
    if (event.type === 'confirmation.required') {
      // 外部运行（方案/Skill）的确认卡也走同一渲染层通道；生图闸门的
      // requestConfirmation 已直接广播，重复广播由卡片端去重（confirmationId）。
      broadcastToWindows('automation:confirmationRequired', event.payload);
    }
    // 朱点忙碌态（SET-02）：外部任务的开始/结束推给渲染层
    const payload = event.payload as { jobId?: string } | null;
    const jobId = payload && typeof payload === 'object' ? payload.jobId : undefined;
    if (!jobId) return;
    if (
      event.type === 'generation.progress' ||
      event.type === 'scheme.run.step' ||
      event.type === 'skill.runtime.delta'
    ) {
      broadcastToWindows('automation:activity', { jobId, running: true });
    }
    if (/\.(completed|failed)$/.test(event.type)) {
      broadcastToWindows('automation:activity', { jobId, running: false });
    }
  });
  server = createAutomationServer({
    core,
    events: hub,
    dataDir: getPaths().userData,
    owner: 'desktop-app',
    appVersion: app.getVersion(),
    capabilities: { setup: true },
    logger,
    routes: {
      ...createV1ReadRoutes(core),
      ...gate.routes,
      ...wrapDurableExternalRunRoutes(
        createExternalRunRoutes(
          hub,
          authorizeExternalSpend,
          (entry) => spendAudit.record({ ...entry, caller: 'http' }),
          spendBudget,
        ),
        hub,
        authorizeExternalSpend,
        isAllowedReferencePath,
      ),
      ...createLocalRoutes(getPaths().userData, createElectronLocalAdminOps()).routes,
      ...createElectronAutomationSetupRoutes(),
      ...hostRoutes,
    },
    onAudit: recordAudit,
  });
  const info = await server.start();
  logger.info('控制面已启动', `port=${info.port}`);
}

export async function stopAutomationServer(): Promise<void> {
  const current = server;
  const currentUploads = automationUploads;
  automationUploads = null;
  server = null;
  for (const entry of gate?.pendingConfirmations() ?? []) {
    gate?.resolveConfirmation(entry.confirmationId, false);
  }
  for (const entry of rendererConfirmations.values()) entry.resolve(false);
  gate = null;
  if (current) {
    await current.stop();
    await auditWriter.flush();
    logger.info('控制面已停止');
  }
  currentUploads?.close();
  unsubscribeEvents?.();
  unsubscribeEvents = null;
}

export async function startAutomationIfEnabled(): Promise<void> {
  if (!getAutomationEnabled()) return;
  try {
    await startAutomationServer();
  } catch (error) {
    // 控制面启动失败不阻断 App 主流程（端口异常等），日志可追溯
    logger.error('控制面启动失败', error);
  }
}

export function getAutomationStatus(): AutomationStatus {
  const info = server?.info ?? null;
  return {
    enabled: getAutomationEnabled(),
    running: server?.listening ?? false,
    port: info?.port ?? null,
    token: info?.token ?? null,
    apiVersion: 'v1',
    discoveryPath: info?.discoveryPath ?? null,
  };
}

export async function setAutomationEnabledAndApply(enabled: boolean): Promise<AutomationStatus> {
  setAutomationEnabled(enabled);
  if (enabled) await startAutomationServer();
  else await stopAutomationServer();
  return getAutomationStatus();
}

export function rotateAutomationToken(): AutomationStatus {
  if (!server?.listening) throw new Error('控制面未在运行，无法轮换 token');
  server.rotateToken();
  return getAutomationStatus();
}

/** 端点级日志（内部诊断）；设置页展示的是花钱审计表。 */
export function listAutomationRequestLog(limit = 50): AutomationAuditEntry[] {
  return auditRing.slice(-Math.max(1, Math.min(limit, AUDIT_RING_LIMIT))).reverse();
}

/** 花钱动作审计（SEC-01 完整落库）：设置页「最近调用」的数据源。 */
export function listAutomationAudit(limit = 50): AutomationSpendAudit[] {
  return createSpendAuditService()
    .list(limit)
    .map((entry) => ({
      id: entry.id,
      at: entry.at,
      action: entry.action,
      promptText: entry.promptText,
      approvedVia: entry.approvedVia,
      status: entry.status,
      estimatedPoints: entry.estimatedPoints,
      actualPoints: entry.actualPoints,
      jobId: entry.jobId,
    }));
}
