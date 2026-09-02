// v2.5 design-scheme IPC seam(P01-4 成功 adapter 切片 + P01-2 详情元数据)。
//
// 本文件把已部署的 16 个 `designSchemes.*` 方法接到保留的本地 runtime:
// - 直连 `packages/core` 独立 design-scheme SQLite(machine-local policy:
//   不接受 renderer 的 owner/workspace,不挂账号,不走 resolveActiveWorkspace)。
// - 确定性读写(list / get / create[携带 document] / update / selectCover /
//   formalize / rename / remove)、市场搜索与上游比对复用仓库与保留服务函数。
// - get 走 v6 元数据读模型:完整资产映射 + legacy 资产懒回填(主进程真实
//   stat/hash/魔数/尺寸探测),缺失或不可读的 legacy 资产直接省略,不伪造。
// - 无法安全映射的操作返回结构化 BridgeError(见 DESIGN_SCHEME_METHOD_UNSUPPORTED_MESSAGES,
//   登记 P01-9/P01-10),不伪造成功、不偷渡平行 DTO。
// - 出参只允许 canonical path-free schema:legacy 的 coverImagePath / storeKey /
//   filePath 绝不进入返回值;意外异常由 gateway-bridge 统一脱敏为 INTERNAL_ERROR。

import {
  cancelDesignSchemeInputSchema,
  checkDesignSchemeUpdateInputSchema,
  createDesignSchemeInputSchema,
  createDesignSchemeResultSchema,
  checkDesignSchemeUpdateResultSchema,
  designSchemeAssetSchema,
  designSchemeDetailInputSchema,
  designSchemeDetailSchema,
  designSchemeEventSchema,
  designSchemeListQuerySchema,
  designSchemeRevisionDocumentSchema,
  designSchemeRunInputSchema,
  designSchemeSummarySchema,
  DESIGN_SCHEME_WIRE_METHODS,
  exportDesignSchemeInputSchema,
  exportDesignSchemeResultSchema,
  formalizeDesignSchemeInputSchema,
  importDesignSchemeInputSchema,
  importDesignSchemeResultSchema,
  marketCandidateSchema,
  marketSearchQuerySchema,
  marketSearchResultSchema,
  modifyDesignSchemeInputSchema,
  promoteWorkingDraftInputSchema,
  removeDesignSchemeInputSchema,
  renameDesignSchemeInputSchema,
  selectCoverInputSchema,
  sourceFileMetadataSchema,
  sourceSnapshotSchema,
  updateDesignSchemeInputSchema,
  type CreateDesignSchemeInput,
  type DesignSchemeRevisionDocument,
  type ParsedDesignSchemeListQuery,
  type SourcePackage,
  type SourceSnapshot,
} from '@musefold/contracts';
import { getDb } from '@musefold/core/db';
import { getDesignSchemeDb } from '@musefold/core/db/design-scheme';
import {
  DesignSchemeRepository,
  DesignSchemeVersionConflictError,
  type AssetMetadataRow,
  type AssetMetadataWrite,
  type SourceFileMetadataRow,
  type SourceSnapshotMetadataRow,
} from '@musefold/core/db/design-scheme/repositories';
import type {
  DesignSchemeCheckUpdateResult,
  DesignSchemeSummary as LegacySummary,
} from '@musefold/desktop-contracts/design-scheme';
import type {
  DesignSchemeRevisionDocument as LegacyDocument,
  SourceBinding as LegacySourceBinding,
} from '@musefold/desktop-contracts/design-scheme/schema';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import {
  app,
  dialog,
  webContents,
  type SaveDialogOptions,
  type SaveDialogReturnValue,
} from 'electron';
import { join } from 'node:path';
import { resolveManagedStoreKey } from '../design-scheme/asset-store';
import { consumeStagedDesignSchemePackage } from '../design-scheme/package-host';
import {
  exportDesignScheme,
  importDesignScheme,
  type ExportResult,
  type ImportResult,
  type ShareDeps,
} from '../design-scheme/share';
import { searchMarketCandidates } from '../design-scheme/market-search';
import { probeImageAssetMetadata, repositoryLabelOf } from '../design-scheme/source-ingestion';
import { checkSchemeUpdate } from '../design-scheme/update-check';
import { getPaths } from '../../system/paths';
import { BridgeError, type MethodDef } from './envelope';
import { runCanonicalDesignScheme } from './design-scheme-run-adapter';
import {
  designSchemeExecutionRegistry,
  cleanupDesignSchemeExecutions,
  drainDesignSchemeExecutions,
  cleanupDesignSchemeExecutionsForSender,
  type DesignSchemeExecutionKind,
} from '../design-scheme/execution-registry';

/** 保留的市场搜索函数签名(可注入以便测试,默认真实网络)。 */
type SearchMarketFn = typeof searchMarketCandidates;
/** 保留的上游更新检查签名(本域只做确定性比对,resolveAdapter 恒为 null)。 */
type CheckUpdateFn = typeof checkSchemeUpdate;
type ConsumeStagedPackageFn = typeof consumeStagedDesignSchemePackage;
type ImportPackageFn = typeof importDesignScheme;
type ExportPackageFn = typeof exportDesignScheme;
type ShowSaveDialogFn = (options: SaveDialogOptions) => Promise<SaveDialogReturnValue>;

function emitDesignSchemeEvent(
  senderId: number,
  event: z.output<typeof designSchemeEventSchema>,
): void {
  const target = webContents.fromId(senderId);
  if (!target || target.isDestroyed()) return;
  try {
    target.send(designSchemeEventChannel, event);
  } catch {
    // A renderer may disappear between the ownership check and send().
  }
}

export interface DesignSchemeDomainDeps {
  /** 独立 design-scheme SQLite;缺省在首次调用时懒解析正式库句柄。 */
  db?: Database.Database;
  /** 主 core SQLite; providers/prompts/workbench/generation 只从这里读取。 */
  coreDb?: Database.Database;
  /** 市场搜索 seam(网络);测试注入。 */
  searchMarket?: SearchMarketFn;
  /** 上游更新检查 seam(GitHub 下载);测试注入。 */
  checkUpdate?: CheckUpdateFn;
  /** managed 来源存储根(userData);legacy 资产懒回填解析 storeKey 用,测试注入。 */
  userDataDir?: string;
  /** managed 生成图片根(pictures);legacy 绝对生图路径只允许落在此根。 */
  picturesDir?: string;
  consumeStagedPackage?: ConsumeStagedPackageFn;
  importPackage?: ImportPackageFn;
  exportPackage?: ExportPackageFn;
  showSaveDialog?: ShowSaveDialogFn;
  downloadsDir?: string;
}

// ---------------------------------------------------------------------------
// 结构化 blocker:语义缺口登记在 docs/v2.5/V25-MIGRATION-CARDS.md 的
// P01-4/P01-9/P01-10,在对应生命周期卡补齐契约与数据模型前显式失败。
// ---------------------------------------------------------------------------

/** create(无 document):Agent 创建管线(来源解析/安装确认/分析/编译)不在共享契约。 */
export const DESIGN_SCHEME_AGENT_CREATION_UNSUPPORTED =
  'DESIGN_SCHEME_AGENT_CREATION_UNSUPPORTED' as const;
/** modify / 上游重编译:Agent 会话(LLM 角色 + 事件产出)不在共享契约。 */
export const DESIGN_SCHEME_AGENT_MODIFY_UNSUPPORTED =
  'DESIGN_SCHEME_AGENT_MODIFY_UNSUPPORTED' as const;
/** checkUpdate:上游有变化,但重编译需要 Agent 管线。 */
export const DESIGN_SCHEME_AGENT_RECOMPILE_REQUIRED =
  'DESIGN_SCHEME_AGENT_RECOMPILE_REQUIRED' as const;
/** run / cancel:RunPlan 有意不含本地 requestTemplate/逐张取消句柄,无法重建生图请求。 */
export const DESIGN_SCHEME_RUN_PIPELINE_UNAVAILABLE =
  'DESIGN_SCHEME_RUN_PIPELINE_UNAVAILABLE' as const;
/**
 * create + historySources:契约已收敛为「渲染层只交稳定身份(runId/assetId/includePrompt),
 * 宿主按成功生成账本做 owner 校验后解析字节与提示词快照」;本地解析管线随 P02 落地前,
 * 显式拒绝而不是静默丢弃用户勾选的历史来源。
 */
export const DESIGN_SCHEME_HISTORY_SOURCES_UNSUPPORTED =
  'DESIGN_SCHEME_HISTORY_SOURCES_UNSUPPORTED' as const;

export const DESIGN_SCHEME_METHOD_UNSUPPORTED_MESSAGES = {
  agentCreation: [
    DESIGN_SCHEME_AGENT_CREATION_UNSUPPORTED,
    '设计方案的 Agent 创建管线(GitHub 来源解析、安装确认、分析、编译)尚未纳入共享契约(P01-9/P01-10)。请传入已编译的 document 走确定性建库路径。',
  ],
  agentModify: [
    DESIGN_SCHEME_AGENT_MODIFY_UNSUPPORTED,
    '修改方案需要 Agent 编译会话与事件流,尚未纳入共享契约(P01-10)。当前可用 update 提交完整新版本文档。',
  ],
  runPipeline: [
    DESIGN_SCHEME_RUN_PIPELINE_UNAVAILABLE,
    '方案运行管线尚未接入:共享 RunPlan 有意不含本地 requestTemplate 与逐张取消句柄,主进程无法安全重建生图请求(P01-10)。因此当前也不存在可取消的 v25 执行。',
  ],
} as const;

function throwUnsupported([code, message]: readonly [string, string]): never {
  throw new BridgeError(code, message);
}

// ---------------------------------------------------------------------------
// legacy ↔ canonical 映射(有损字段逐条声明;本地路径/凭据字段一律丢弃)。
// ---------------------------------------------------------------------------

/** 消息兜底脱敏:截断并抹掉疑似本地路径片段。 */
function scrubText(value: string): string {
  return value
    .replace(/[A-Za-z]:[\\/][^\s;]*/g, '[路径已脱敏]')
    .replace(/(?:\/(?:Users|home|tmp|var|private)\/)[^\s;]*/g, '[路径已脱敏]')
    .slice(0, 300);
}

function safeMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return scrubText(error.message);
  return fallback;
}

function firstZodIssue(error: z.ZodError): string {
  const first = error.issues[0];
  return first ? `${first.path.join('.') || '?'}: ${first.message}` : '文档无法映射';
}

/** 仓库/运行时异常 → 稳定 BridgeError;未知异常原样抛出,由 bridge 统一脱敏。 */
function mapDomainError(error: unknown, fallback: string): never {
  if (error instanceof BridgeError) throw error;
  if (error instanceof DesignSchemeVersionConflictError) {
    throw new BridgeError('DESIGN_SCHEME_VERSION_CONFLICT', safeMessage(error, fallback));
  }
  if (error instanceof Error && error.message === '设计方案不存在') {
    throw new BridgeError('NOT_FOUND', '设计方案不存在或已删除');
  }
  if (error instanceof z.ZodError) {
    throw new BridgeError('DESIGN_SCHEME_MAPPING_FAILED', firstZodIssue(error));
  }
  if (error instanceof Error && error.message.startsWith('设计方案文档')) {
    throw new BridgeError('DESIGN_SCHEME_DOCUMENT_UNMAPPABLE', safeMessage(error, fallback));
  }
  if (error instanceof Error) {
    throw new BridgeError('DESIGN_SCHEME_INVALID_STATE', safeMessage(error, fallback));
  }
  throw error;
}

/** legacy summary → canonical summary;coverImagePath(本地存储键)丢弃。 */
function toCanonicalSummary(summary: LegacySummary): z.output<typeof designSchemeSummarySchema> {
  const candidate = {
    id: summary.id,
    name: summary.name,
    summary: summary.summary,
    status: summary.status,
    sourcePresentation: summary.sourcePresentation,
    // 空字符串交给 schema default(''),否则 min(1) 会拒绝。
    ...(summary.sourceLabel ? { sourceLabel: summary.sourceLabel } : {}),
    currentRevisionId: summary.currentRevisionId,
    version: summary.version,
    ...(summary.workingDraftRevisionId != null
      ? { workingDraftRevisionId: summary.workingDraftRevisionId }
      : {}),
    ...(summary.coverAssetId != null ? { coverAssetId: summary.coverAssetId } : {}),
    fidelity: summary.fidelity,
    inputLabels: summary.inputLabels,
    hasSuccessfulTrial: summary.hasSuccessfulTrial,
    ...(summary.lastRunAt != null ? { lastRunAt: summary.lastRunAt } : {}),
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
  };
  const parsed = designSchemeSummarySchema.safeParse(candidate);
  if (!parsed.success) {
    throw new BridgeError(
      'DESIGN_SCHEME_SUMMARY_UNMAPPABLE',
      `方案 ${summary.id} 无法映射为共享契约:${firstZodIssue(parsed.error)}`,
    );
  }
  return parsed.data;
}

/** canonical trace 的已收敛子集(legacy 文档枚举无 'running')。 */
type SettledTraceItem = Omit<
  DesignSchemeRevisionDocument['compilation']['trace'][number],
  'status'
> & { status: 'success' | 'warning' | 'error' };

/** canonical document → legacy document(写路径;别名归一,canonical-only 字段不入库)。 */
function toLegacyDocument(document: DesignSchemeRevisionDocument): LegacyDocument {
  return {
    schemaVersion: document.schemaVersion,
    revisionId: document.revisionId,
    schemeId: document.schemeId,
    name: document.name,
    summary: document.summary,
    fidelity: document.fidelity,
    sources: document.sources.map((source) => {
      const uri = source.repositoryUrl ?? source.uri;
      const ref = source.resolvedRef ?? source.ref;
      const commit = source.commitHash ?? source.commit;
      const filePath = source.relativePath ?? source.evidencePath;
      const contentHash = source.contentHash ?? source.hash;
      return {
        id: source.id,
        kind: source.kind,
        role: source.role,
        ...(uri ? { uri } : {}),
        ...(ref ? { ref } : {}),
        ...(commit ? { commit } : {}),
        // 仓库内相对路径;canonical evidencePath 别名归一到 filePath。
        ...(filePath ? { filePath } : {}),
        ...(contentHash ? { contentHash } : {}),
        ...(source.license != null ? { license: source.license } : {}),
      } satisfies LegacySourceBinding;
    }),
    inputs: document.inputs,
    parameters: document.parameters,
    // legacy 约束没有 evidencePath:有损,证据来源以 sourceIds 保留。
    constraints: document.constraints.map((constraint) => ({
      id: constraint.id,
      domain: constraint.domain,
      statement: constraint.statement,
      mode: constraint.mode,
      sourceIds: constraint.sourceIds,
      userOverridable: constraint.userOverridable,
    })),
    promptProgram: document.promptProgram,
    compilation: {
      compiledAt:
        typeof document.compilation.compiledAt === 'string'
          ? Date.parse(document.compilation.compiledAt)
          : document.compilation.compiledAt,
      model: document.compilation.model,
      adopted: document.compilation.adopted,
      omitted: document.compilation.omitted,
      warnings: document.compilation.warnings,
      ...(document.compilation.briefExcerpt != null
        ? { briefExcerpt: document.compilation.briefExcerpt }
        : {}),
      // legacy trace 无 kind/output 字段:有损,步骤状态与结论保留;
      // 'running' 是瞬态,不可变文档里直接落库会破坏 legacy 枚举,创建时视为已结束丢弃。
      trace: document.compilation.trace
        .filter((item): item is SettledTraceItem => item.status !== 'running')
        .map((item) => ({
          id: item.id,
          title: item.title,
          ...(item.detail != null ? { detail: item.detail } : {}),
          status: item.status,
          ...(item.durationMs != null ? { durationMs: item.durationMs } : {}),
        })),
    },
  };
}

/** legacy document → canonical document(读路径);不可表示时结构化失败。 */
function toCanonicalDocument(document: LegacyDocument): DesignSchemeRevisionDocument {
  const candidate = {
    schemaVersion: document.schemaVersion,
    revisionId: document.revisionId,
    schemeId: document.schemeId,
    name: document.name,
    summary: document.summary,
    fidelity: document.fidelity,
    sources: document.sources.map((source) => ({
      id: source.id,
      kind: source.kind,
      role: source.role,
      ...(source.uri ? { uri: source.uri } : {}),
      ...(source.ref ? { resolvedRef: source.ref } : {}),
      ...(source.commit ? { commitHash: source.commit } : {}),
      ...(source.filePath ? { relativePath: source.filePath } : {}),
      ...(source.contentHash ? { contentHash: source.contentHash } : {}),
      ...(source.license != null ? { license: source.license } : {}),
    })),
    inputs: document.inputs,
    parameters: document.parameters,
    constraints: document.constraints,
    promptProgram: document.promptProgram,
    compilation: document.compilation,
  };
  const parsed = designSchemeRevisionDocumentSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new BridgeError(
      'DESIGN_SCHEME_DOCUMENT_UNMAPPABLE',
      `方案版本 ${document.revisionId} 无法映射为共享契约:${firstZodIssue(parsed.error)}`,
    );
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// 详情映射(P01-2):当前 revision 文档 + 完整资产 + path-free 来源快照。
// ---------------------------------------------------------------------------

/**
 * 资产行 → canonical(完整元数据才映射):
 * - 新写入(v6)直接用持久化元数据;
 * - legacy 行元数据不全时,主进程对 storeKey 做真实 stat/hash/魔数/尺寸探测并回填;
 * - 缺失/不可读/无法解析的 legacy 资产返回 null(详情省略),绝不伪造元数据。
 */
function toCanonicalAsset(
  repository: DesignSchemeRepository,
  row: AssetMetadataRow,
  userDataDir: string,
  picturesDir: string,
): z.output<typeof designSchemeAssetSchema> | null {
  let metadata: AssetMetadataWrite | null =
    row.mimeType != null &&
    row.width != null &&
    row.height != null &&
    row.byteSize != null &&
    row.contentHash != null
      ? {
          mimeType: row.mimeType,
          width: row.width,
          height: row.height,
          byteSize: row.byteSize,
          contentHash: row.contentHash,
        }
      : null;
  if (!metadata) {
    const managedPath = resolveManagedStoreKey(row.storeKey, userDataDir, picturesDir);
    if (!managedPath) return null;
    const probed = probeImageAssetMetadata(managedPath);
    if (!probed) return null;
    repository.backfillAssetMetadata(row.id, probed);
    metadata = probed;
  }
  const parsed = designSchemeAssetSchema.safeParse({
    id: row.id,
    origin: row.origin,
    mimeType: metadata.mimeType,
    width: metadata.width,
    height: metadata.height,
    byteSize: metadata.byteSize,
    contentHash: metadata.contentHash,
    role: row.role,
    license: row.license,
    createdAt: row.createdAt,
  });
  return parsed.success ? parsed.data : null;
}

/**
 * 来源文件 → canonical:节选(textExcerpt)过不了 canonical 安全校验时置 null
 * 保留条目;其余字段(相对路径/hash)仍不合法则整条省略,不毒化详情。
 */
function toCanonicalSourceFile(file: SourceFileMetadataRow) {
  const candidate = {
    relativePath: file.path,
    kind: file.kind,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    contentHash: file.contentHash,
    evidencePath: file.evidencePath,
    textExcerpt: file.textExcerpt,
  };
  let parsed = sourceFileMetadataSchema.safeParse(candidate);
  if (!parsed.success && candidate.textExcerpt != null) {
    parsed = sourceFileMetadataSchema.safeParse({ ...candidate, textExcerpt: null });
  }
  return parsed.success ? parsed.data : null;
}

/** 来源快照 → canonical;必需字段(ref 等)无法表示时省略整个快照。 */
function toCanonicalSourceSnapshot(snapshot: SourceSnapshotMetadataRow) {
  const files = snapshot.files.flatMap((file) => {
    const canonical = toCanonicalSourceFile(file);
    return canonical ? [canonical] : [];
  });
  const parsed = sourceSnapshotSchema.safeParse({
    id: snapshot.snapshotId,
    packageId: snapshot.packageId,
    kind: snapshot.packageKind,
    repositoryUrl: snapshot.repositoryUrl,
    resolvedRef: snapshot.ref,
    commitHash: snapshot.commitHash,
    contentHash: snapshot.contentHash,
    totalBytes: snapshot.totalBytes,
    files,
    createdAt: snapshot.createdAt,
  });
  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------------------
// 列表过滤与游标(仓库 listSummaries 上限 200,内存分页)。
// ---------------------------------------------------------------------------

function parseOffsetCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const offset = Number.parseInt(cursor, 10);
  return Number.isFinite(offset) && offset >= 0 ? offset : 0;
}

function matchesQuery(summary: LegacySummary, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return [summary.name, summary.summary, summary.sourceLabel, summary.id]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(needle));
}

// ---------------------------------------------------------------------------
// 确定性创建:持久化 canonical 来源元数据并落草稿。
// ---------------------------------------------------------------------------

function packageUriOf(source: SourcePackage | SourceSnapshot): string | undefined {
  return source.repositoryUrl ?? source.repositoryUri ?? source.uri ?? undefined;
}

function persistCanonicalSources(
  repository: DesignSchemeRepository,
  input: CreateDesignSchemeInput,
): Array<{ snapshotId: string; role: LegacySourceBinding['role'] }> {
  const packagesById = new Map(input.sourcePackages.map((pkg) => [pkg.id, pkg]));
  for (const snapshot of input.sourceSnapshots) {
    const pkg = packagesById.get(snapshot.packageId);
    const kind = pkg?.kind ?? snapshot.kind;
    // 本地 source_packages.kind 列 CHECK 只接受三种;share-import 属被阻断的导入路径。
    if (kind === 'share-import') {
      throw new BridgeError(
        'DESIGN_SCHEME_CREATE_SOURCE_UNSUPPORTED',
        '本地方案库不支持 share-import 来源包(导入分享包路径尚未接入,P01-9)。',
      );
    }
    const uri = packageUriOf(pkg ?? snapshot);
    repository.saveSourceSnapshot({
      package: {
        id: snapshot.packageId,
        kind,
        ...(uri ? { repositoryUrl: uri } : {}),
        ...(pkg?.license != null ? { license: pkg.license } : {}),
      },
      snapshot: {
        id: snapshot.id,
        ref: snapshot.resolvedRef ?? snapshot.ref ?? '',
        commitHash: snapshot.commitHash ?? snapshot.commit ?? null,
        ...(snapshot.contentHash != null ? { contentHash: snapshot.contentHash } : {}),
        totalBytes: snapshot.totalBytes,
        scan: {},
      },
      files: snapshot.files.map((file) => ({
        path: file.relativePath,
        kind: file.kind,
        contentHash: file.contentHash,
        sizeBytes: file.sizeBytes,
        // v6:mimeType/evidencePath 已有本地列,canonical 创建即持久化。
        ...(file.mimeType != null ? { mimeType: file.mimeType } : {}),
        ...(file.evidencePath != null && file.evidencePath !== ''
          ? { evidencePath: file.evidencePath }
          : {}),
        ...(file.textExcerpt != null ? { textContent: file.textExcerpt } : {}),
      })),
    });
  }
  return input.sourceBindings
    .filter((binding) => binding.snapshotId)
    .map((binding) => ({ snapshotId: binding.snapshotId as string, role: binding.role }));
}

/** 来源展示:有 GitHub 来源记 skill(owner/repo),否则记 Musefold 创建。 */
function derivePresentation(input: CreateDesignSchemeInput): {
  sourcePresentation: 'skill' | 'musefold-created';
  sourceLabel: string;
} {
  const githubPackage = input.sourcePackages.find(
    (pkg) => pkg.kind === 'github' && packageUriOf(pkg),
  );
  const githubUri =
    input.sourceUris[0] ?? (githubPackage ? packageUriOf(githubPackage) : undefined);
  if (githubUri) {
    return { sourcePresentation: 'skill', sourceLabel: repositoryLabelOf(githubUri) };
  }
  return { sourcePresentation: 'musefold-created', sourceLabel: 'Musefold 创建' };
}

// ---------------------------------------------------------------------------
// 方法表
// ---------------------------------------------------------------------------

export function buildDesignSchemesDomainMethods(
  deps: DesignSchemeDomainDeps = {},
): Record<string, MethodDef> {
  const resolveDb = (): Database.Database => deps.db ?? getDesignSchemeDb();
  const repository = (): DesignSchemeRepository => new DesignSchemeRepository(resolveDb());
  const searchMarketFn: SearchMarketFn = deps.searchMarket ?? searchMarketCandidates;
  const checkUpdateFn: CheckUpdateFn = deps.checkUpdate ?? checkSchemeUpdate;
  const consumeStagedPackage: ConsumeStagedPackageFn =
    deps.consumeStagedPackage ?? consumeStagedDesignSchemePackage;
  const importPackageFn: ImportPackageFn = deps.importPackage ?? importDesignScheme;
  const exportPackageFn: ExportPackageFn = deps.exportPackage ?? exportDesignScheme;
  const showSaveDialog: ShowSaveDialogFn =
    deps.showSaveDialog ?? ((options) => dialog.showSaveDialog(options));
  const runtimeDeps = () => {
    const paths = getPaths();
    return {
      db: resolveDb(),
      coreDb: deps.coreDb ?? getDb(),
      userDataDir: deps.userDataDir ?? paths.userData,
      picturesDir: deps.picturesDir ?? paths.pictures,
      executionRegistry: designSchemeExecutionRegistry,
      emit: emitDesignSchemeEvent,
    };
  };

  const shareDeps = (): ShareDeps => {
    const paths = getPaths();
    return {
      db: resolveDb(),
      userDataDir: deps.userDataDir ?? paths.userData,
      picturesDir: deps.picturesDir ?? paths.pictures,
    };
  };

  const requireCanonicalSummary = (schemeId: string) => {
    try {
      return toCanonicalSummary(repository().requireSummary(schemeId));
    } catch (error) {
      mapDomainError(error, '设计方案不存在');
    }
  };

  return {
    [DESIGN_SCHEME_WIRE_METHODS.list]: {
      input: designSchemeListQuerySchema,
      async handle(raw) {
        const query = raw as ParsedDesignSchemeListQuery;
        try {
          const summaries = repository()
            .listSummaries()
            .filter(
              (summary) =>
                (!query.status || summary.status === query.status) &&
                (!query.fidelity || summary.fidelity === query.fidelity) &&
                matchesQuery(summary, query.query ?? ''),
            );
          const offset = parseOffsetCursor(query.cursor);
          const page = summaries.slice(offset, offset + query.limit);
          return {
            items: page.map(toCanonicalSummary),
            nextCursor:
              offset + query.limit < summaries.length ? String(offset + query.limit) : null,
          };
        } catch (error) {
          mapDomainError(error, '读取方案列表失败');
        }
      },
    },
    [DESIGN_SCHEME_WIRE_METHODS.get]: {
      input: designSchemeDetailInputSchema,
      async handle(raw) {
        const input = raw as z.output<typeof designSchemeDetailInputSchema>;
        try {
          const repo = repository();
          const summary = repo.requireSummary(input.id);
          const canonicalSummary = toCanonicalSummary(summary);
          const revisionId =
            input.revision.kind === 'current'
              ? summary.currentRevisionId
              : input.revision.revisionId;
          if (
            input.revision.kind === 'working-draft' &&
            summary.workingDraftRevisionId !== revisionId
          ) {
            throw new BridgeError(
              'DESIGN_SCHEME_INVALID_STATE',
              '待验证版本与方案当前状态不一致，请刷新后重试',
            );
          }
          const legacyDocument = repo.getRevisionDocument(revisionId);
          if (!legacyDocument) {
            throw new BridgeError('NOT_FOUND', '设计方案版本不存在');
          }
          const document = toCanonicalDocument(legacyDocument);
          const paths = getPaths();
          const userDataDir = deps.userDataDir ?? paths.userData;
          const picturesDir = deps.picturesDir ?? paths.pictures;
          const assets = repo
            .listAssetMetadataRows(input.id)
            .flatMap((row) => {
              const canonical = toCanonicalAsset(repo, row, userDataDir, picturesDir);
              return canonical ? [canonical] : [];
            })
            .slice(0, 128);
          const sourceSnapshots = repo
            .listSourceSnapshotMetadata(input.id, revisionId)
            .flatMap((snapshot) => {
              const canonical = toCanonicalSourceSnapshot(snapshot);
              return canonical ? [canonical] : [];
            })
            .slice(0, 32);
          const parsed = designSchemeDetailSchema.safeParse({
            summary: canonicalSummary,
            document,
            assets,
            sourceSnapshots,
          });
          if (!parsed.success) {
            throw new BridgeError(
              'DESIGN_SCHEME_DETAIL_UNMAPPABLE',
              `方案 ${input.id} 详情无法映射为共享契约:${firstZodIssue(parsed.error)}`,
            );
          }
          return parsed.data;
        } catch (error) {
          mapDomainError(error, '读取方案详情失败');
        }
      },
    },
    [DESIGN_SCHEME_WIRE_METHODS.searchMarket]: {
      input: marketSearchQuerySchema,
      async handle(raw) {
        const query = raw as z.output<typeof marketSearchQuerySchema>;
        const result = await searchMarketFn(query.query, { db: resolveDb() });
        if (!result.ok) {
          throw new BridgeError(
            'DESIGN_SCHEME_MARKET_SEARCH_FAILED',
            scrubText(`搜索市场失败:${result.error.message}`),
          );
        }
        // GitHub 描述是外部输入:单条候选无法满足 canonical 安全校验
        // (路径/签名 URL/凭据形态)时丢弃该条,不让脏数据拖垮整页搜索。
        const candidates = result.data.candidates
          .flatMap((candidate) => {
            // legacy 候选无 commit 字段;canonical 必填可空,统一补 null。
            const parsed = marketCandidateSchema.safeParse({ ...candidate, commit: null });
            return parsed.success ? [parsed.data] : [];
          })
          .slice(0, query.limit);
        return marketSearchResultSchema.parse({
          query: result.data.query,
          fromCache: result.data.fromCache,
          fetchedAt: result.data.fetchedAt,
          candidates,
          // 保留搜索固定取回前 N 条,无续页语义。
          nextCursor: null,
        });
      },
    },
    [DESIGN_SCHEME_WIRE_METHODS.create]: {
      input: createDesignSchemeInputSchema,
      async handle(raw) {
        const input = raw as CreateDesignSchemeInput;
        if (!input.document) {
          throwUnsupported(DESIGN_SCHEME_METHOD_UNSUPPORTED_MESSAGES.agentCreation);
        }
        // 历史来源选择是渲染层输入:在宿主侧账本解析(owner 校验 + 提示词快照)接入前
        // fail-closed,绝不静默丢弃,也绝不退回接收绝对本机路径的旧历史入参。
        if (input.historySources.length > 0) {
          throw new BridgeError(
            DESIGN_SCHEME_HISTORY_SOURCES_UNSUPPORTED,
            '设计方案创建尚未接入历史来源解析(按 runId/assetId 从成功生成账本读取,P02)。请先不带 historySources 创建。',
          );
        }
        const document = input.document;
        try {
          const repo = repository();
          // canonical id 由调用方生成:重复创建给出结构化错误而非裸 SQLite 约束失败。
          try {
            repo.requireSummary(document.schemeId);
            throw new BridgeError(
              'DESIGN_SCHEME_ALREADY_EXISTS',
              `设计方案已存在:${document.schemeId}`,
            );
          } catch (error) {
            if (!(error instanceof Error) || error.message !== '设计方案不存在') throw error;
          }
          const bindings = persistCanonicalSources(repo, input);
          const { sourcePresentation, sourceLabel } = derivePresentation(input);
          const created = repo.insertSchemeDraft({
            document: toLegacyDocument(document),
            sourceLabel,
            sourcePresentation,
            // document 由调用方显式提交,确定性建库记为 user。
            createdBy: 'user',
            bindings,
          });
          return createDesignSchemeResultSchema.parse({
            scheme: toCanonicalSummary(created),
            document,
            revisionId: document.revisionId,
            trace: [],
          });
        } catch (error) {
          mapDomainError(error, '创建设计方案失败');
        }
      },
    },
    [DESIGN_SCHEME_WIRE_METHODS.update]: {
      input: updateDesignSchemeInputSchema,
      async handle(raw) {
        const input = raw as z.output<typeof updateDesignSchemeInputSchema>;
        try {
          const updated = repository().applyAgentRevision(
            input.schemeId,
            input.baseRevisionId,
            toLegacyDocument(input.document),
            [],
            input.expectedVersion,
          );
          return {
            scheme: toCanonicalSummary(updated.summary),
            document: toCanonicalDocument(updated.document),
          };
        } catch (error) {
          mapDomainError(error, '更新设计方案失败');
        }
      },
    },
    [DESIGN_SCHEME_WIRE_METHODS.modify]: {
      input: modifyDesignSchemeInputSchema,
      async handle() {
        throwUnsupported(DESIGN_SCHEME_METHOD_UNSUPPORTED_MESSAGES.agentModify);
      },
    },
    [DESIGN_SCHEME_WIRE_METHODS.cancel]: {
      input: cancelDesignSchemeInputSchema,
      async handle(raw, context) {
        const input = raw as z.output<typeof cancelDesignSchemeInputSchema>;
        if (!context || !Number.isSafeInteger(context.senderId) || context.senderId <= 0) {
          throw new BridgeError(
            'DESIGN_SCHEME_EXECUTION_OWNER_REQUIRED',
            '执行取消需要有效的 renderer 所有者',
          );
        }
        const outcome = designSchemeExecutionRegistry.cancel(context.senderId, input.executionId);
        if (outcome.status === 'not-found') {
          throw new BridgeError('DESIGN_SCHEME_EXECUTION_NOT_FOUND', '执行不存在或不属于当前窗口');
        }
        return {
          executionId: input.executionId,
          status: outcome.status === 'cancelled' ? 'cancelled' : 'already-terminal',
        };
      },
    },
    [DESIGN_SCHEME_WIRE_METHODS.selectCover]: {
      input: selectCoverInputSchema,
      async handle(raw) {
        const input = raw as z.output<typeof selectCoverInputSchema>;
        try {
          const updated = repository().selectCover(
            input.schemeId,
            input.assetId,
            input.expectedVersion,
          );
          return {
            scheme: toCanonicalSummary(updated),
            selectedAssetId: input.assetId,
          };
        } catch (error) {
          mapDomainError(error, '设置封面失败');
        }
      },
    },
    [DESIGN_SCHEME_WIRE_METHODS.formalize]: {
      input: formalizeDesignSchemeInputSchema,
      async handle(raw) {
        const input = raw as z.output<typeof formalizeDesignSchemeInputSchema>;
        // canonical 入参携带 revision/cover 断言:与本地当前状态一致才继续,
        // 不满足时拒绝,而不是静默采用本地已选封面。
        const summary = requireCanonicalSummary(input.schemeId);
        if (summary.status !== 'draft') {
          throw new BridgeError('DESIGN_SCHEME_INVALID_STATE', '方案已是正式状态');
        }
        if (input.revisionId !== summary.currentRevisionId) {
          throw new BridgeError(
            'DESIGN_SCHEME_INVALID_STATE',
            '转正基线与当前版本不一致,请刷新后再试',
          );
        }
        if (input.coverAssetId !== summary.coverAssetId) {
          throw new BridgeError(
            'DESIGN_SCHEME_INVALID_STATE',
            '封面断言与已选封面不一致,请先通过 selectCover 选择封面',
          );
        }
        try {
          const formalized = repository().formalize(input.schemeId, input.expectedVersion);
          return {
            scheme: toCanonicalSummary(formalized),
            revisionId: formalized.currentRevisionId,
            formalized: true as const,
          };
        } catch (error) {
          mapDomainError(error, '转为正式方案失败');
        }
      },
    },
    [DESIGN_SCHEME_WIRE_METHODS.rename]: {
      input: renameDesignSchemeInputSchema,
      async handle(raw) {
        const input = raw as z.output<typeof renameDesignSchemeInputSchema>;
        // 共享契约上限 120,本地列与旧校验上限 80:先给明确结构化错误。
        if (input.name.trim().length > 80) {
          throw new BridgeError(
            'DESIGN_SCHEME_NAME_TOO_LONG',
            '本地方案名上限 80 字符(共享契约为 120);需先放宽本地列宽再放开长名。',
          );
        }
        try {
          const renamed = repository().rename(input.schemeId, input.name, input.expectedVersion);
          return { scheme: toCanonicalSummary(renamed) };
        } catch (error) {
          mapDomainError(error, '重命名方案失败');
        }
      },
    },
    [DESIGN_SCHEME_WIRE_METHODS.remove]: {
      input: removeDesignSchemeInputSchema,
      async handle(raw) {
        const input = raw as z.output<typeof removeDesignSchemeInputSchema>;
        try {
          repository().softDelete(input.schemeId, input.expectedVersion);
          return { schemeId: input.schemeId, removed: true as const };
        } catch (error) {
          mapDomainError(error, '删除方案失败');
        }
      },
    },
    [DESIGN_SCHEME_WIRE_METHODS.checkUpdate]: {
      input: checkDesignSchemeUpdateInputSchema,
      async handle(raw) {
        const input = raw as z.output<typeof checkDesignSchemeUpdateInputSchema>;
        // 复用保留的更新检查,resolveAdapter 恒 null:上游有变化时不触发
        // Agent 重编译,而是返回 AUTH_REQUIRED,由下面映射为明确 blocker。
        const result = await checkUpdateFn(input.schemeId, {
          db: resolveDb(),
          resolveAdapter: () => null,
          ...(input.revisionId ? { requestedRevisionId: input.revisionId } : {}),
        });
        if (!result.ok) {
          if (result.error.code === 'AUTH_REQUIRED') {
            throw new BridgeError(
              DESIGN_SCHEME_AGENT_RECOMPILE_REQUIRED,
              '上游已有更新,但重新编译需要 Agent 管线,尚未纳入共享契约(P01-10)。',
            );
          }
          if (result.error.code === 'MISSING_REFERENCE') {
            throw new BridgeError('NOT_FOUND', '设计方案不存在或已删除');
          }
          throw new BridgeError(
            'DESIGN_SCHEME_UPDATE_CHECK_FAILED',
            scrubText(`检查上游更新失败:${result.error.message}`),
          );
        }
        const data: DesignSchemeCheckUpdateResult = result.data;
        return checkDesignSchemeUpdateResultSchema.parse({
          status: data.status,
          detail: data.detail,
          scheme: data.scheme ? toCanonicalSummary(data.scheme) : null,
          revisionId: data.revisionId ?? null,
        });
      },
    },
    [DESIGN_SCHEME_WIRE_METHODS.promoteWorkingDraft]: {
      input: promoteWorkingDraftInputSchema,
      async handle(raw) {
        const input = raw as z.output<typeof promoteWorkingDraftInputSchema>;
        // canonical 入参断言待验证草稿 id:与本地指针一致才继续,
        // 避免把用户确认过的新版本换成之后产生的另一份草稿。
        const summary = requireCanonicalSummary(input.schemeId);
        if (summary.workingDraftRevisionId !== input.workingDraftRevisionId) {
          throw new BridgeError(
            'DESIGN_SCHEME_INVALID_STATE',
            '待验证草稿与当前状态不一致,请刷新后再试',
          );
        }
        try {
          const promoted = repository().promoteWorkingDraft(input.schemeId, input.expectedVersion);
          return {
            scheme: toCanonicalSummary(promoted),
            promotedRevisionId: promoted.currentRevisionId,
            promoted: true as const,
          };
        } catch (error) {
          mapDomainError(error, '替换正式版本失败');
        }
      },
    },
    [DESIGN_SCHEME_WIRE_METHODS.importPackage]: {
      input: importDesignSchemeInputSchema,
      async handle(raw, context) {
        const input = raw as z.output<typeof importDesignSchemeInputSchema>;
        if (!context || !Number.isSafeInteger(context.senderId) || context.senderId <= 0) {
          throw new BridgeError(
            'DESIGN_SCHEME_PACKAGE_OWNER_REQUIRED',
            '导入分享包需要有效的 renderer 所有者',
          );
        }
        try {
          const imported = await consumeStagedPackage(
            context.senderId,
            input,
            async (packagePath) => {
              const result = await importPackageFn(packagePath, shareDeps());
              if (!result.ok) {
                throw new BridgeError(
                  'DESIGN_SCHEME_PACKAGE_IMPORT_FAILED',
                  scrubText(result.error.message),
                );
              }
              return result.data;
            },
          );
          return importDesignSchemeResultSchema.parse({
            scheme: toCanonicalSummary((imported as ImportResult).scheme),
            revisionId: imported.revisionId,
            status: 'draft',
          });
        } catch (error) {
          if (error instanceof BridgeError) throw error;
          throw new BridgeError(
            'DESIGN_SCHEME_PACKAGE_IMPORT_FAILED',
            safeMessage(error, '导入设计方案失败'),
          );
        }
      },
    },
    [DESIGN_SCHEME_WIRE_METHODS.exportPackage]: {
      input: exportDesignSchemeInputSchema,
      async handle(raw) {
        const input = raw as z.output<typeof exportDesignSchemeInputSchema>;
        const target = await showSaveDialog({
          title: '导出设计方案',
          defaultPath: join(
            deps.downloadsDir ?? app.getPath('downloads'),
            `${input.schemeId}.musefold.design`,
          ),
          filters: [{ name: 'Musefold 设计方案', extensions: ['musefold.design'] }],
        });
        if (target.canceled || !target.filePath) {
          return exportDesignSchemeResultSchema.parse({
            schemeId: input.schemeId,
            status: 'cancelled',
          });
        }
        const result = await exportPackageFn(
          input.schemeId,
          target.filePath,
          shareDeps(),
          input.revisionId,
        );
        if (!result.ok) {
          throw new BridgeError(
            'DESIGN_SCHEME_PACKAGE_EXPORT_FAILED',
            scrubText(result.error.message),
          );
        }
        const exported = result.data as ExportResult;
        return exportDesignSchemeResultSchema.parse({
          package: {
            id: exported.packageId,
            format: 'musefold.design',
            formatVersion: input.formatVersion,
            contentHash: exported.contentHash,
            sizeBytes: exported.sizeBytes,
            createdAt: new Date(exported.createdAt).toISOString(),
          },
          schemeId: input.schemeId,
          status: 'delivered',
        });
      },
    },
    [DESIGN_SCHEME_WIRE_METHODS.run]: {
      input: designSchemeRunInputSchema,
      async handle(raw, context) {
        const input = raw as z.output<typeof designSchemeRunInputSchema>;
        if (!context || !Number.isSafeInteger(context.senderId) || context.senderId <= 0) {
          throw new BridgeError(
            'DESIGN_SCHEME_EXECUTION_OWNER_REQUIRED',
            '执行运行需要有效的 renderer 所有者',
          );
        }
        return runCanonicalDesignScheme(input, context.senderId, runtimeDeps());
      },
    },
  };
}

export const designSchemeEventChannel = 'designSchemes:event' as const;

export function parseDesignSchemeEvent(value: unknown) {
  return designSchemeEventSchema.parse(value);
}
