// electron/system/export.ts
// 导出引擎（TASK-SET-01）—— versioned JSON 信封 + 可选图片包 zip
//
// 三条设计约束，都是踩过的坑：
//
// 1. **不走 repository.list()**。prompts.list() 尾部有 LIMIT 1000、搜索路径 LIMIT 500，
//    拿它做导出会在大库上静默截断——用户以为备份了 3000 条，实际只有 1000。
//    这里直接查表，导出必须是全量。
//
// 2. **字段白名单而非黑名单**。providers 段用显式 SELECT 列出要导的列，而不是
//    SELECT * 再 delete 敏感字段。将来 schema 加了新的敏感列（比如缓存的 token），
//    黑名单会默认泄漏，白名单会默认不导出。
//
// 3. **redact 兜底**。密钥不该出现在自由文本里，但用户会把 curl 命令粘进 content。
//    导出前扫一遍，命中就打码并计数，让用户知道发生过什么。

import { writeFile, stat, realpath } from 'fs/promises';
import { createWriteStream } from 'fs';
import { join, basename, isAbsolute, normalize, sep } from 'path';
import archiver from 'archiver';
import { getDb } from '@musefold/core/db/index';
import { getPaths } from './paths';
import { createLogger, redact } from './logger';
import { APP_VERSION } from './app-version';
import {
  EXPORT_FORMAT,
  EXPORT_SCHEMA_VERSION,
  EXPORT_JSON_NAME,
  EXPORT_IMAGES_DIR,
} from '@musefold/domain/export-format';
import type {
  ExportEnvelope,
  ExportMode,
  ExportRequest,
  ExportResult,
} from '@musefold/desktop-contracts/ipc';

const logger = createLogger('export');

/** 自由文本字段过 redact；返回打码后的值 + 是否命中 */
function scrub(value: string | null): { value: string | null; hit: boolean } {
  if (value == null || value === '') return { value, hit: false };
  const out = redact(value);
  return { value: out, hit: out !== value };
}

type Counter = { n: number };

/** 对一个对象的指定字段做 redact 兜底，命中数累加到 counter */
function scrubFields<T extends Record<string, unknown>>(
  obj: T,
  fields: readonly (keyof T)[],
  counter: Counter
): T {
  for (const f of fields) {
    const cur = obj[f];
    if (typeof cur !== 'string') continue;
    const { value, hit } = scrub(cur);
    if (hit) {
      (obj as Record<string, unknown>)[f as string] = value;
      counter.n += 1;
    }
  }
  return obj;
}

const num = (v: unknown): number | null => (v == null ? null : Number(v));
const str = (v: unknown): string | null => (v == null ? null : String(v));
const bool = (v: unknown): boolean => v === 1 || v === true;

/** JSON 列安全解析：坏数据不该让整次导出失败 */
function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || raw === '') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * 聚合导出载荷。
 *
 * @param includeDeleted 默认 false —— 软删项属于"回收站里的东西"，不该跟着备份跑。
 * @param includeHistory 默认 false —— 历史含提示词快照与成本，是隐私不是资产（doc 16 §4.7 红线）。
 */
export function buildExportPayload(opts: {
  mode: ExportMode;
  includeHistory?: boolean;
  includeDeleted?: boolean;
}): { envelope: ExportEnvelope; redactedFields: number; imagePaths: string[] } {
  const db = getDb();
  const counter: Counter = { n: 0 };
  const notDeleted = opts.includeDeleted ? '' : ' WHERE deleted_at IS NULL';

  const folders = (
    db.prepare('SELECT id, name, parent_id, sort_order, created_at FROM folders').all() as Record<
      string,
      unknown
    >[]
  ).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    parentId: str(r.parent_id),
    sortOrder: Number(r.sort_order ?? 0),
    createdAt: Number(r.created_at),
  }));

  const tags = (
    db.prepare('SELECT id, name, tag_group, color, created_at FROM tags').all() as Record<
      string,
      unknown
    >[]
  ).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    tagGroup: str(r.tag_group),
    color: str(r.color),
    createdAt: Number(r.created_at),
  }));

  // prompt → tagIds：一次查全表关系再分组，避免每条 prompt 一次查询（N+1）
  const tagMap = new Map<string, string[]>();
  for (const r of db.prepare('SELECT prompt_id, tag_id FROM prompt_tags').all() as Record<
    string,
    unknown
  >[]) {
    const pid = r.prompt_id as string;
    const list = tagMap.get(pid) ?? [];
    list.push(r.tag_id as string);
    tagMap.set(pid, list);
  }

  const imagePaths: string[] = [];

  const prompts = (
    db
      .prepare(
        `SELECT id, title, description, content, content_negative, folder_id, model_id, params,
                preview_image_path, rating, is_pinned, pin_order, usage_count, last_used_at,
                source, source_url, created_at, updated_at, deleted_at
         FROM prompts${notDeleted}`
      )
      .all() as Record<string, unknown>[]
  ).map((r) => {
    const preview = str(r.preview_image_path);
    if (preview) imagePaths.push(preview);
    const out = {
      id: r.id as string,
      title: r.title as string,
      description: str(r.description),
      content: r.content as string,
      contentNegative: str(r.content_negative),
      folderId: str(r.folder_id),
      modelId: str(r.model_id),
      params: parseJson<unknown>(r.params, null),
      previewImagePath: preview,
      rating: Number(r.rating ?? 0),
      isPinned: bool(r.is_pinned),
      pinOrder: num(r.pin_order),
      usageCount: Number(r.usage_count ?? 0),
      lastUsedAt: num(r.last_used_at),
      source: str(r.source),
      sourceUrl: str(r.source_url),
      tagIds: tagMap.get(r.id as string) ?? [],
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
      ...(opts.includeDeleted ? { deletedAt: num(r.deleted_at) } : {}),
    };
    return scrubFields(out, ['content', 'contentNegative', 'description', 'sourceUrl'], counter);
  });

  // 🔒 Provider：**显式白名单**。绝不 SELECT *。
  // has_key / key_suffix 都不导出 —— 它们会暗示"这个站有密钥、末位是 xxxx"，
  // 是无谓的信息泄漏面（doc 16 §4.7 红线）。密钥本体与 safeStorage 密文更不用说。
  const providers = (
    db
      .prepare(
        `SELECT id, name, type, base_url, model, is_active, created_at, updated_at
         FROM providers
         WHERE managed_by IS NULL`
      )
      .all() as Record<string, unknown>[]
	  ).map((r) => ({
	    id: r.id as string,
	    name: r.name as string,
	    type: r.type as string,
	    baseUrl: r.base_url as string,
    model: r.model as string,
    isActive: bool(r.is_active),
    createdAt: Number(r.created_at),
	    updatedAt: Number(r.updated_at),
	  }));

  const smartSets = (
    db
      .prepare('SELECT id, name, query, sort_order, created_at, updated_at FROM smart_sets')
      .all() as Record<string, unknown>[]
  ).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    query: parseJson<unknown>(r.query, {}),
    sortOrder: Number(r.sort_order ?? 0),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  }));

  const envelope: ExportEnvelope = {
    format: EXPORT_FORMAT,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    dbUserVersion: db.pragma('user_version', { simple: true }) as number,
    appVersion: APP_VERSION,
    exportedAt: Date.now(),
    mode: opts.mode,
    counts: {
      prompts: prompts.length,
      folders: folders.length,
      tags: tags.length,
      smartSets: smartSets.length,
      providers: providers.length,
    },
    data: {
      prompts,
      folders,
      tags,
      smartSets,
      providers,
    },
  };

  // history 默认缺席；开了开关才带，且同样过 redact
  if (opts.includeHistory) {
    const referenceRows = db.prepare(
      `SELECT history_id, prompt_id, prompt_title, excerpt, scope, sort_order
       FROM history_prompt_references
       ORDER BY history_id, sort_order`,
    ).all() as Record<string, unknown>[];
    const referencesByHistory = new Map<string, Record<string, unknown>[]>();
    for (const reference of referenceRows) {
      const historyId = String(reference.history_id);
      const item = scrubFields({
        promptId: str(reference.prompt_id),
        title: String(reference.prompt_title),
        text: String(reference.excerpt),
        scope: String(reference.scope),
        sortOrder: Number(reference.sort_order),
      }, ['title', 'text'], counter);
      const existing = referencesByHistory.get(historyId) ?? [];
      existing.push(item);
      referencesByHistory.set(historyId, existing);
    }
    const history = (
      db
        .prepare(
          `SELECT id, prompt_id, provider_id, model, prompt_text,
                  negative_text, params, status, error_code, error_message, image_path, cost,
                  cost_unit, duration_ms, created_at
           FROM history`
        )
        .all() as Record<string, unknown>[]
    ).map((r) => {
      const img = str(r.image_path);
      if (img) imagePaths.push(img);
      const out = {
        id: r.id as string,
        promptId: str(r.prompt_id),
        providerId: r.provider_id as string,
        model: r.model as string,
        promptText: r.prompt_text as string,
        negativeText: str(r.negative_text),
        params: parseJson<unknown>(r.params, null),
        status: r.status as string,
        errorCode: str(r.error_code),
        errorMessage: str(r.error_message),
        imagePath: img,
        cost: num(r.cost),
        costUnit: 'point',
        durationMs: num(r.duration_ms),
        createdAt: Number(r.created_at),
        promptReferences: referencesByHistory.get(String(r.id)) ?? [],
      };
      return scrubFields(out, ['promptText', 'negativeText', 'errorMessage'], counter);
    });
    envelope.data.history = history;
    envelope.counts.history = history.length;
  }

  return { envelope, redactedFields: counter.n, imagePaths };
}

/**
 * 图片路径白名单化：只允许打包 userData 下的 previews/ 与图片目录里的文件。
 *
 * DB 里的路径来自历史写入，未必可信；不设闸门的话一条
 * `../../../.ssh/id_rsa` 就能把任意文件塞进导出包。
 *
 * **两侧都要 realpath**，原因有两个，缺一不可：
 *
 * 1. 少了会误杀。macOS 的 `app.getPath('userData')` 返回 `/private/var/...`，
 *    而别处写进 DB 的同一个文件可能是 `/var/...`（`/var` 是符号链接）。
 *    纯字符串前缀比对会判定"越界"，于是合法预览图被静默剔出导出包 ——
 *    用户拿到一个少图的备份且毫无提示。符号链接的家目录、Windows junction
 *    也是同样的下场。
 * 2. 少了会漏。`previews/evil.png` 是个指向 `~/.ssh/id_rsa` 的符号链接时，
 *    裸路径能过前缀检查，紧接着 archiver 顺着链接把私钥打进包。先解析真实
 *    路径再比对，这条路就断了。
 *
 * 解析失败（文件不存在、断链）一律当越界处理 —— 反正也打不进包。
 */
async function resolveSafeImagePath(
  raw: string,
  allowedRoots: string[]
): Promise<string | null> {
  const abs = isAbsolute(raw) ? normalize(raw) : normalize(join(getPaths().userData, raw));
  const real = await realpath(abs).catch(() => null);
  if (!real) return null;
  const ok = allowedRoots.some(
    (r) => real === r || real.startsWith(r.endsWith(sep) ? r : r + sep)
  );
  return ok ? real : null;
}

/**
 * 把白名单根目录解析成真实路径，供上面比对。
 * 目录可能还不存在（用户一张图都没生成过），解析失败就退回规范化路径。
 */
async function realRoots(roots: string[]): Promise<string[]> {
  return Promise.all(roots.map((r) => realpath(r).catch(() => normalize(r))));
}

/** 写 JSON 导出；返回落盘路径 */
async function writeJsonExport(envelope: ExportEnvelope, targetPath: string): Promise<void> {
  await writeFile(targetPath, JSON.stringify(envelope, null, 2), 'utf-8');
}

/**
 * 写 zip 导出：JSON + 被引用到的图片。
 *
 * 明确不打包：data.db（含 FTS 与软删，且导入端不吃它）、electron-store 的
 * providers 密钥文件、logs/。这三样是 doc 16 §4.7 点名的禁区。
 */
/**
 * 把 DB 里的图片路径整理成"确定能打进包"的条目表。
 *
 * dryRun 与真导出**共用它**：预览说"含 12 张图"、实际包里只有 9 张（3 张被用户
 * 删了或越界），是最容易让人以为备份不全的那种不一致。同一份计算就不会有这问题。
 */
async function collectImageEntries(
  imagePaths: string[]
): Promise<{ abs: string; name: string }[]> {
  const paths = getPaths();
  const allowedRoots = await realRoots([paths.previews, paths.pictures]);

  // 去重后逐个校验存在性——DB 里挂着的路径可能早被用户删了，缺图不该让导出失败
  const unique = Array.from(new Set(imagePaths));
  const entries: { abs: string; name: string }[] = [];
  const seenNames = new Set<string>();
  for (const raw of unique) {
    const abs = await resolveSafeImagePath(raw, allowedRoots);
    if (!abs) {
      // 不存在的图和越界的图都走这里。前者是常态（用户删了原图），
      // 后者才值得注意，但两者都只是跳过，不该让整个导出失败。
      logger.warn('导出跳过图片（不存在或越界）', redact(raw));
      continue;
    }
    const info = await stat(abs).catch(() => null);
    if (!info?.isFile()) continue;
    // 同名不同目录会互相覆盖，加序号去冲突
    let name = basename(abs);
    if (seenNames.has(name)) {
      const dot = name.lastIndexOf('.');
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : '';
      name = `${stem}-${entries.length}${ext}`;
    }
    seenNames.add(name);
    entries.push({ abs, name });
  }
  return entries;
}

async function writeZipExport(
  envelope: ExportEnvelope,
  entries: { abs: string; name: string }[],
  targetPath: string
): Promise<{ images: number }> {
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(targetPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    out.on('close', () => resolve());
    out.on('error', reject);
    archive.on('error', reject);
    // 缺图之类的软错误不该炸掉整包
    archive.on('warning', (err) => logger.warn('导出打包告警', redact(err.message)));
    archive.pipe(out);
    archive.append(JSON.stringify(envelope, null, 2), { name: EXPORT_JSON_NAME });
    for (const e of entries) archive.file(e.abs, { name: `${EXPORT_IMAGES_DIR}/${e.name}` });
    void archive.finalize();
  });

  return { images: entries.length };
}

/** 默认导出文件名：带时间戳，避免覆盖上一次备份 */
export function defaultExportName(mode: ExportMode): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `musefold-${stamp}.${mode === 'db-with-images' ? 'zip' : 'json'}`;
}

/**
 * 执行导出。
 *
 * @param targetPath 落盘路径；`req.dryRun` 时忽略（传空串即可）
 */
export async function runExport(req: ExportRequest, targetPath: string): Promise<ExportResult> {
  const mode: ExportMode = req.mode ?? 'db-only';
  const { envelope, redactedFields, imagePaths } = buildExportPayload({
    mode,
    includeHistory: req.includeHistory,
    includeDeleted: req.includeDeleted,
  });

  // 带图模式先把图片清单算出来 —— 预览和真导出用的是同一份，
  // 于是"预计 12 张"和包里的张数必然一致。
  const entries = mode === 'db-with-images' ? await collectImageEntries(imagePaths) : [];

  // 预览：只把统计交回去。对话框拿它显示"预计包含…"，与真导出同源，
  // 不会出现预览说 312 条、导出文件里只有 300 条这种情况。
  if (req.dryRun) {
    return {
      path: '',
      counts: envelope.counts,
      redactedFields,
      images: mode === 'db-with-images' ? entries.length : undefined,
      dryRun: true,
    };
  }

  let images: number | undefined;
  if (mode === 'db-with-images') {
    ({ images } = await writeZipExport(envelope, entries, targetPath));
  } else {
    await writeJsonExport(envelope, targetPath);
  }

  logger.info(
    '导出完成',
    `mode=${mode}`,
    `counts=${JSON.stringify(envelope.counts)}`,
    images != null ? `images=${images}` : '',
    redactedFields > 0 ? `redacted=${redactedFields}` : ''
  );

  return { path: targetPath, counts: envelope.counts, redactedFields, images, dryRun: false };
}
