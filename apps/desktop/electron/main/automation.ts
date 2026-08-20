// 控制面生命周期（V04-API-01/02 的 Electron 宿主接线）。
// whenReady 后按设置启动；before-quit 停止并删除发现文件。
// 审计骨架：内存环（最近 200 条）+ NDJSON 追加（logsDir/automation-audit.ndjson）；
// P3 SEC-01 再升级为完整落库。

import { appendFile, mkdir } from 'fs/promises';
import { realpathSync } from 'fs';
import { randomUUID } from 'crypto';
import { join, resolve, sep } from 'path';
import { app, BrowserWindow, Notification } from 'electron';
import {
  AutomationError,
  createAutomationServer,
  createGenerationGate,
  createV1ReadRoutes,
  type AuditRecord,
  type AutomationRouteHandler,
  type AutomationServer,
  type ConfirmationSummary,
  type GenerationGate,
  type GenerationHost,
} from '@musefold/automation-server';
import { createLocalRoutes } from '@musefold/automation-server';
import { createExternalRunRoutes, externalSpendCovered } from './automation-runs';
import { createElectronLocalAdminOps } from './automation-local';
import { createElectronAutomationSetupRoutes } from './automation-setup';
import { CoreError } from '@musefold/core';
import { getDb } from '@musefold/core/db/index';
import { createSpendAuditService, type SpendAuditEntry } from '@musefold/core/services/audit';
import { stageLocalImageBytes } from '@musefold/core/providers/local-image';
import { trackPetGeneration } from './pet';
import type { AutomationAuditEntry, AutomationSpendAudit, AutomationStatus } from '@musefold/desktop-contracts/ipc';
import { createLogger } from '../system/logger';
import { getPaths } from '../system/paths';
import { estimateProviderCost } from '../settings/pricing';
import {
  getAutomationEnabled,
  remainingAutomationBudgetPoints,
  setAutomationEnabled,
  settleAutomationBudget,
} from '../settings/automation';
import { getCoreEventHub, getMusefoldCore } from './core-instance';

const AUDIT_RING_LIMIT = 200;
const AUDIT_FILE = 'automation-audit.ndjson';

const logger = createLogger('automation');
const auditRing: AutomationAuditEntry[] = [];
let server: AutomationServer | null = null;
let gate: GenerationGate | null = null;
let auditChain: Promise<void> = Promise.resolve();
/** 宿主注入的额外路由（P3 方案/Skill 运行）。启动前注册。 */
const hostRoutes: Record<string, AutomationRouteHandler> = {};
/** 渲染层确认卡的挂起回执：confirmationId → settle */
const rendererConfirmations = new Map<string, (approved: boolean) => void>();

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
  return new Promise((resolvePromise) => {
    rendererConfirmations.set(summary.confirmationId, (approved) => {
      rendererConfirmations.delete(summary.confirmationId);
      resolvePromise(approved ? 'approved' : 'denied');
    });
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
function createElectronGenerationHost(): GenerationHost {
  const core = getMusefoldCore();
  return {
    // 外部 Agent 触发的生成不经过 ipc/images 的门面，桌宠追踪要在这里单独接上
    run: (req, onProgress) => trackPetGeneration(() => core.generation.generate(req, onProgress)),
    cancel: (jobId) => core.generation.cancel(jobId),
    estimate(body) {
      const db = getDb();
      const row = (body.providerId
        ? db.prepare('SELECT * FROM providers WHERE id = ?').get(body.providerId)
        : db.prepare('SELECT * FROM providers WHERE is_active = 1 LIMIT 1').get()) as
        | Record<string, unknown>
        | undefined;
      if (!row) {
        throw new CoreError('INVALID_STATE', body.providerId ? '指定的 Provider 不存在' : '没有激活的图像 Provider', {
          providerId: body.providerId ?? null,
        });
      }
      const n = body.n ?? 1;
      return {
        points: estimatePointsFromRow(row, n),
        providerId: row.id as string,
        providerName: row.name as string,
        model: body.model ?? (row.model as string),
        n,
      };
    },
    budget: {
      remainingPoints: () => remainingAutomationBudgetPoints(),
      settle: (actualPoints) => settleAutomationBudget(actualPoints),
    },
    requestConfirmation: (summary) => requestRendererConfirmation(summary),
    authorizeReferencePath: isAllowedReferencePath,
    stageUpload: (bytes, name, mimeType) =>
      stageLocalImageBytes({ bytes, name, mimeType: mimeType as 'image/png' | 'image/jpeg' | 'image/webp' }),
    resolveHistoryImage(historyId) {
      const row = getDb().prepare('SELECT image_path FROM history WHERE id = ?').get(historyId) as
        | { image_path: string | null }
        | undefined;
      return row?.image_path ? { path: row.image_path } : null;
    },
  };
}

/** App 确认卡回执（IPC 侧）：同时回执给闸门与渲染层挂起项（外部运行只在后者）。 */
export function resolveAutomationConfirmation(confirmationId: string, approved: boolean): boolean {
  const rendererHandled = rendererConfirmations.has(confirmationId);
  rendererConfirmations.get(confirmationId)?.(approved);
  const gateHandled = gate?.resolveConfirmation(confirmationId, approved) ?? false;
  return rendererHandled || gateHandled;
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
  // 串行追加，失败静默（审计骨架不阻断请求处理）
  auditChain = auditChain
    .then(async () => {
      const dir = getPaths().logs;
      await mkdir(dir, { recursive: true });
      await appendFile(join(dir, AUDIT_FILE), `${JSON.stringify(entry)}\n`, 'utf8');
    })
    .catch(() => {});
}

/** 方案/Skill 运行的花钱授权：预算覆盖即放行，否则 App 确认卡（120s 超时）。 */
async function authorizeExternalSpend(summary: {
  providerName: string;
  model: string;
  n: number;
  estimatedPoints: number | null;
  promptPreview: string;
}): Promise<void> {
  if (externalSpendCovered(summary.estimatedPoints)) return;
  const confirmation: ConfirmationSummary = { confirmationId: randomUUID(), ...summary };
  getCoreEventHub().sink.emit({ type: 'confirmation.required', payload: confirmation });
  const verdict = await Promise.race([
    requestRendererConfirmation(confirmation),
    new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 120_000)),
  ]);
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
  gate = createGenerationGate(createElectronGenerationHost(), hub, {
    onSpendAudit: (entry) => spendAudit.record({ ...entry, caller: 'http' }),
  });
  // 确认事件转发给渲染层（卡片被 HTTP 回执/超时解决时同步关闭）
  hub.subscribe((event) => {
    if (event.type === 'confirmation.resolved') {
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
    if (event.type === 'generation.progress' || event.type === 'scheme.run.step' || event.type === 'skill.runtime.delta') {
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
      ...createExternalRunRoutes(hub, authorizeExternalSpend, (entry) =>
        spendAudit.record({ ...entry, caller: 'http' }),
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
  server = null;
  gate = null;
  rendererConfirmations.clear();
  if (current) {
    await current.stop();
    logger.info('控制面已停止');
  }
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
