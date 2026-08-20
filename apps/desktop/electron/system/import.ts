// electron/system/import.ts
// 导入引擎（TASK-SET-02）—— 校验 → 备份 → 单事务写入 → 重建 FTS
//
// 五条不可动摇的规则：
//
// 1. **整个导入是一个事务**。中途失败必须整体回滚，不能留下"一半提示词有、
//    标签关系没了"的库。better-sqlite3 的 db.transaction() 同步执行，正好适配。
//
// 2. **写完必须重建 FTS**。prompts_fts 是独立表、无触发器（分词在 JS 侧，
//    SQL 触碰不到），直接 INSERT prompts 会让新导入的条目搜不出来 —— 一个不报错
//    的静默失败。收尾统一调 promptsRepo.reindexFts()。
//
// 3. **外键顺序**：folders/tags 先行，prompts/history 其后，prompt_tags 最后。
//    另外 foreign_keys = ON，所以指向缺失父项的引用必须先降级
//    为 NULL（可空外键）或跳过该条（NOT NULL 外键），否则一条脏数据带崩整个事务。
//
// 4. **绝不导入密钥**。信封里本来就没有；这里也把 has_key / key_suffix 写死成
//    0 / NULL —— 照抄导出方的状态会让 UI 显示"已配置"而实际调用必然 401。
//
// 5. **zip 里的图片要落地并改写路径**。导出方的绝对路径在本机不存在，
//    不解出来就是一堆死链。解压走白名单文件名，杜绝 zip-slip。

import { readFile, mkdir, writeFile } from 'fs/promises';
import { join, basename } from 'path';
import yauzl from 'yauzl';
import type { Database } from 'better-sqlite3';
import { getDb } from '@musefold/core/db/index';
import { promptsRepo } from '@musefold/core/db/repositories/prompts';
import { createLogger, redact } from './logger';
import { getPaths } from './paths';
import { createBackup } from './backup';
import { validateEnvelope, EXPORT_IMAGES_DIR } from '@musefold/domain/export-format';
import type {
  ExportEnvelope,
  ImportRequest,
  ImportResult,
  ImportSourceInfo,
  ImportStrategy,
  ImportTypeStat,
} from '@shared/types/ipc';

const logger = createLogger('import');

/** 参与导入的表名（byType 的 key 集合） */
const TYPES = [
  'prompts',
  'folders',
  'tags',
  'smartSets',
  'providers',
  'history',
] as const;
type TypeName = (typeof TYPES)[number];

function zeroStats(): Record<TypeName, ImportTypeStat> {
  const out = {} as Record<TypeName, ImportTypeStat>;
  for (const t of TYPES) out[t] = { imported: 0, updated: 0, skipped: 0, failed: 0 };
  return out;
}

type Row = Record<string, unknown>;

const asStr = (v: unknown): string | null =>
  typeof v === 'string' && v !== '' ? v : typeof v === 'number' ? String(v) : null;
const asNum = (v: unknown, dflt: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
};
const asNullNum = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const asBoolInt = (v: unknown, dflt = 0): number => (v == null ? dflt : v ? 1 : 0);
/**
 * 对象/数组回写成 TEXT 列。
 *
 * 字符串**必须先验证能 parse** 才原样保留。这不是洁癖：全库有十来处
 * `JSON.parse(r.params)` 是裸的（repositories 与 history/images 的 IPC），
 * 因为在导入功能出现之前，这些列的唯一写入方就是本应用，永远是合法 JSON。
 * 导入把「文件里的任意字符串」变成了新的写入源 —— 一条
 * `params: "{ 坏了"` 落库后，prompt.list() 会直接抛，
 * **整个资源库视图加载失败且用户在 UI 上无法自救**。
 *
 * 所以闸门设在写入侧：进库的这几列只可能是合法 JSON 或 NULL。
 * 解析不了的一律降级为 NULL（丢一份参数，好过让库打不开）。
 */
const asJson = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === 'string') {
    try {
      JSON.parse(v);
      return v;
    } catch {
      return null;
    }
  }
  try {
    return JSON.stringify(v);
  } catch {
    return null;
  }
};
const arr = (v: unknown): Row[] =>
  Array.isArray(v) ? (v.filter((x) => x != null && typeof x === 'object') as Row[]) : [];

/**
 * 软删状态的两个绑定参数，配合 `deleted_at = CASE WHEN ? THEN ? ELSE deleted_at END`。
 *
 * 为什么不能直接写 `deleted_at = ?`：导出端默认 `includeDeleted:false`，
 * 这时信封里**根本没有 deletedAt 这个键**（export.ts 里是条件展开）。
 * 直接绑 `asNullNum(r.deletedAt)` 会得到 NULL，于是覆盖写入把本机的软删状态清掉 ——
 * **回收站里的条目悄悄回到资源库**，而用户以为自己只是恢复了一份备份。
 *
 * 触发它需要 incoming 的 updatedAt 比本机新：同机「导出→删除→导入」是安全的
 * （软删会把 updated_at 顶到删除时刻，merge 于是跳过），
 * 但跨机同步就会踩到 —— A 机在 T3 编辑过，B 机在 T2 把它删了，
 * 导入 A 的文件后这条在 B 机复活。
 *
 * 所以要区分「键不存在」和「键存在且为 null」：
 *   - 不存在 → 回收站不在本次导入的范围内，本机 deleted_at 原样保留
 *   - 存在 → 按文件里的值写（含显式 null，那是一次真正的「恢复」意图）
 */
const softDeleteArgs = (r: Row): [number, number | null] =>
  'deletedAt' in r ? [1, asNullNum(r.deletedAt)] : [0, null];

// ---------------------------------------------------------------- zip 读取

interface ZipContents {
  envelope: ExportEnvelope;
  /** 原文件名（basename） → 解压后的本机绝对路径 */
  images: Map<string, string>;
}

/**
 * 读 zip：取出导出 JSON，并把 previews/ 下的图片解到本机 previews 目录。
 *
 * **zip-slip 防线**：只认 `previews/<basename>` 形态的条目，落盘名一律
 * 重新 basename() 过。带 `../` 的条目在第一步就被判掉，不存在拼出
 * `../../.ssh/authorized_keys` 的可能。
 */
async function readZip(path: string): Promise<ZipContents> {
  const previewsDir = getPaths().previews;
  await mkdir(previewsDir, { recursive: true });

  return new Promise<ZipContents>((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('无法打开 zip 文件'));

      let envelope: ExportEnvelope | null = null;
      const images = new Map<string, string>();
      const pending: Promise<void>[] = [];

      const bail = (e: Error): void => {
        zip.close();
        reject(e);
      };

      zip.on('entry', (entry) => {
        const name = entry.fileName;

        // 目录条目 / 元数据文件直接跳过
        if (name.endsWith('/')) return zip.readEntry();

        const prefix = `${EXPORT_IMAGES_DIR}/`;
        const isJson = name.endsWith('.json') && !name.includes('/');
        const isPreview =
          name.startsWith(prefix) &&
          name.indexOf('/', prefix.length) === -1 &&
          !name.includes('..');

        if (!isJson && !isPreview) {
          logger.warn('导入跳过 zip 内非预期条目', redact(name));
          return zip.readEntry();
        }

        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return bail(e ?? new Error('无法读取 zip 条目'));
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('error', bail);
          stream.on('end', () => {
            const buf = Buffer.concat(chunks);
            if (isJson) {
              try {
                envelope = JSON.parse(buf.toString('utf-8')) as ExportEnvelope;
              } catch (pe) {
                return bail(new Error(`zip 内 JSON 解析失败: ${(pe as Error).message}`));
              }
            } else {
              // 落盘名加 imported- 前缀，避免和本机已有同名预览图对撞
              const safe = `imported-${Date.now()}-${basename(name)}`;
              const dest = join(previewsDir, safe);
              pending.push(
                writeFile(dest, buf).then(() => {
                  images.set(basename(name), dest);
                })
              );
            }
            zip.readEntry();
          });
        });
      });

      zip.on('end', () => {
        void Promise.all(pending)
          .then(() => {
            if (!envelope) return reject(new Error('zip 内未找到导出 JSON'));
            resolve({ envelope, images });
          })
          .catch(reject);
      });
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

/** 读文件为信封（自动识别 JSON / zip） */
export async function loadEnvelope(path: string): Promise<ZipContents> {
  if (path.toLowerCase().endsWith('.zip')) return readZip(path);
  const raw = await readFile(path, 'utf-8');
  try {
    return { envelope: JSON.parse(raw) as ExportEnvelope, images: new Map() };
  } catch (err) {
    throw new Error(`JSON 解析失败: ${(err as Error).message}`, { cause: err });
  }
}

// ---------------------------------------------------------------- 写入

/**
 * replace 策略要清的表。顺序 = 反向外键顺序，先清子表再清父表。
 * history 也一并清 —— 留着会指向已不存在的 prompt_id。
 */
const REPLACE_ORDER = [
  'prompt_tags',
  'search_history',
  'smart_sets',
  'history_prompt_references',
  'history',
  'prompts',
  'tags',
  'folders',
] as const;

interface Ctx {
  db: Database;
  strategy: ImportStrategy;
  stats: Record<TypeName, ImportTypeStat>;
  warnings: string[];
  /** zip 里解出来的图片：原 basename → 本机路径 */
  images: Map<string, string>;
}

function idSet(db: Database, table: string): Set<string> {
  const rows = db.prepare(`SELECT id FROM ${table}`).all() as { id: string }[];
  return new Set(rows.map((r) => r.id));
}

function warn(ctx: Ctx, msg: string): void {
  // 警告会进日志、也会回到渲染层展示，统一过 redact
  if (ctx.warnings.length < 50) ctx.warnings.push(redact(msg));
}

/**
 * merge 冲突裁决：导入方 updatedAt 更新才覆盖，否则保留本地（doc 16 §TASK-SET-02）。
 * skip 一律保留本地。replace 走到这里说明表已清空，不会有冲突。
 */
function shouldOverwrite(ctx: Ctx, incomingUpdatedAt: number, localUpdatedAt: number): boolean {
  return ctx.strategy === 'merge' && incomingUpdatedAt > localUpdatedAt;
}

/** 取本机某表的 id → updated_at，供 merge 比较新旧 */
function updatedAtMap(db: Database, table: string): Map<string, number> {
  const rows = db.prepare(`SELECT id, updated_at FROM ${table}`).all() as Row[];
  return new Map(rows.map((r) => [String(r.id), Number(r.updated_at ?? 0)]));
}

/** 把导出方的图片路径映射到本机解压出来的那份；zip 里没有就保持原样 */
function mapImagePath(ctx: Ctx, raw: string | null): string | null {
  if (!raw) return null;
  return ctx.images.get(basename(raw)) ?? raw;
}

/** 执行导入的写入部分；必须在事务内调用 */
function applyEnvelope(ctx: Ctx, env: ExportEnvelope): void {
  const { db, stats } = ctx;
  const now = Date.now();
  const d = env.data;

  if (ctx.strategy === 'replace') {
    for (const t of REPLACE_ORDER) db.prepare(`DELETE FROM ${t}`).run();
    db.prepare('DELETE FROM prompts_fts').run();
  }

  // ---- folders：父引用可能指向本次导入里更靠后的行，所以先插全部再补 parent_id ----
  const existingFolders = idSet(db, 'folders');
  const pendingParents: { id: string; parentId: string }[] = [];
  const insFolder = db.prepare(
    'INSERT INTO folders (id, name, parent_id, sort_order, created_at) VALUES (?, ?, NULL, ?, ?)'
  );
  // folders 表没有 updated_at，无从比较新旧 → merge 与 skip 同义（都保留本地）
  for (const r of arr(d.folders)) {
    const id = asStr(r.id);
    const name = asStr(r.name);
    if (!id || !name) {
      stats.folders.failed += 1;
      warn(ctx, '文件夹缺少 id 或 name，已跳过');
      continue;
    }
    if (existingFolders.has(id)) {
      stats.folders.skipped += 1;
      continue;
    }
    insFolder.run(id, name, asNum(r.sortOrder, 0), asNum(r.createdAt, now));
    existingFolders.add(id);
    stats.folders.imported += 1;
    const parentId = asStr(r.parentId);
    if (parentId) pendingParents.push({ id, parentId });
  }
  const setParent = db.prepare('UPDATE folders SET parent_id = ? WHERE id = ?');
  for (const { id, parentId } of pendingParents) {
    // 父不存在（导出时被裁掉/文件被手改）就留在根目录，别为此炸掉整次导入
    if (existingFolders.has(parentId)) setParent.run(parentId, id);
    else warn(ctx, `文件夹 ${id} 的父级 ${parentId} 不存在，已置为根目录`);
  }

  // ---- tags：name 有 UNIQUE 约束，同名视为同一个标签，需要建 id 映射 ----
  const existingTags = idSet(db, 'tags');
  const tagByName = new Map<string, string>();
  for (const r of db.prepare('SELECT id, name FROM tags').all() as Row[]) {
    tagByName.set(String(r.name), String(r.id));
  }
  /** 导入文件里的 tagId → 本机实际 tagId */
  const tagIdMap = new Map<string, string>();
  const insTag = db.prepare(
    'INSERT INTO tags (id, name, tag_group, color, created_at) VALUES (?, ?, ?, ?, ?)'
  );
  for (const r of arr(d.tags)) {
    const id = asStr(r.id);
    const name = asStr(r.name);
    if (!id || !name) {
      stats.tags.failed += 1;
      warn(ctx, '标签缺少 id 或 name，已跳过');
      continue;
    }
    if (existingTags.has(id)) {
      stats.tags.skipped += 1;
      tagIdMap.set(id, id);
      continue;
    }
    const sameName = tagByName.get(name);
    if (sameName) {
      // 同名不同 id：复用本机那个，并把引用重定向过去。
      // 直接插会撞 UNIQUE(name) 让整个事务失败。
      stats.tags.skipped += 1;
      tagIdMap.set(id, sameName);
      continue;
    }
    insTag.run(id, name, asStr(r.tagGroup), asStr(r.color), asNum(r.createdAt, now));
    existingTags.add(id);
    tagByName.set(name, id);
    tagIdMap.set(id, id);
    stats.tags.imported += 1;
  }

  // ---- prompts ----
  const promptUpdated = updatedAtMap(db, 'prompts');
  const insPrompt = db.prepare(
    `INSERT INTO prompts (id, title, description, content, content_negative, folder_id, model_id,
       params, preview_image_path, rating, is_pinned, pin_order, usage_count, last_used_at,
       source, source_url, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const updPrompt = db.prepare(
    `UPDATE prompts SET title = ?, description = ?, content = ?, content_negative = ?,
       folder_id = ?, model_id = ?, params = ?, preview_image_path = ?, rating = ?,
       is_pinned = ?, pin_order = ?, usage_count = ?, last_used_at = ?, source = ?,
       source_url = ?, updated_at = ?,
       deleted_at = CASE WHEN ? THEN ? ELSE deleted_at END WHERE id = ?`
  );
  const insPromptTag = db.prepare(
    'INSERT OR IGNORE INTO prompt_tags (prompt_id, tag_id) VALUES (?, ?)'
  );
  const delPromptTags = db.prepare('DELETE FROM prompt_tags WHERE prompt_id = ?');
  for (const r of arr(d.prompts)) {
    const id = asStr(r.id);
    const title = asStr(r.title);
    const content = asStr(r.content);
    if (!id || !title || content == null) {
      stats.prompts.failed += 1;
      warn(ctx, '提示词缺少 id/title/content，已跳过');
      continue;
    }
    const incomingUpdated = asNum(r.updatedAt, now);
    const local = promptUpdated.get(id);
    if (local != null && !shouldOverwrite(ctx, incomingUpdated, local)) {
      stats.prompts.skipped += 1;
      continue;
    }

    // folder_id 是 ON DELETE SET NULL 的可空外键 → 父缺失时降级，不拒收整条
    let folderId = asStr(r.folderId);
    if (folderId && !existingFolders.has(folderId)) {
      warn(ctx, `提示词 ${id} 的文件夹 ${folderId} 不存在，已置为未归档`);
      folderId = null;
    }
    const preview = mapImagePath(ctx, asStr(r.previewImagePath));

    if (local != null) {
      updPrompt.run(
        title,
        asStr(r.description),
        content,
        asStr(r.contentNegative),
        folderId,
        asStr(r.modelId),
        asJson(r.params),
        preview,
        asNum(r.rating, 0),
        asBoolInt(r.isPinned),
        asNullNum(r.pinOrder),
        asNum(r.usageCount, 0),
        asNullNum(r.lastUsedAt),
        asStr(r.source),
        asStr(r.sourceUrl),
        incomingUpdated,
        ...softDeleteArgs(r),
        id
      );
      // 覆盖时标签关系整体替换，否则会残留本地旧标签
      delPromptTags.run(id);
      stats.prompts.updated += 1;
    } else {
      insPrompt.run(
        id,
        title,
        asStr(r.description),
        content,
        asStr(r.contentNegative),
        folderId,
        asStr(r.modelId),
        asJson(r.params),
        preview,
        asNum(r.rating, 0),
        asBoolInt(r.isPinned),
        asNullNum(r.pinOrder),
        asNum(r.usageCount, 0),
        asNullNum(r.lastUsedAt),
        asStr(r.source),
        asStr(r.sourceUrl),
        asNum(r.createdAt, now),
        incomingUpdated,
        asNullNum(r.deletedAt)
      );
      promptUpdated.set(id, incomingUpdated);
      stats.prompts.imported += 1;
    }
    for (const rawTagId of Array.isArray(r.tagIds) ? r.tagIds : []) {
      const src = asStr(rawTagId);
      if (!src) continue;
      // 走映射：同名标签在本机可能是另一个 id
      const mapped = tagIdMap.get(src) ?? (existingTags.has(src) ? src : null);
      if (mapped) insPromptTag.run(id, mapped);
      else warn(ctx, `提示词 ${id} 引用的标签 ${src} 不存在，已忽略该关系`);
    }
  }
  const existingPrompts = new Set(promptUpdated.keys());

  // ---- smartSets：保存的是 Library 查询快照，无外键；坏 JSON 降级为空查询 ----
  const smartSetUpdated = updatedAtMap(db, 'smart_sets');
  const insSmartSet = db.prepare(
    `INSERT INTO smart_sets (id, name, query, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const updSmartSet = db.prepare(
    `UPDATE smart_sets SET name = ?, query = ?, sort_order = ?, updated_at = ? WHERE id = ?`
  );
  for (const r of arr(d.smartSets)) {
    const id = asStr(r.id);
    const name = asStr(r.name);
    if (!id || !name) {
      stats.smartSets.failed += 1;
      warn(ctx, '智能集合缺少 id 或 name，已跳过');
      continue;
    }
    const query = asJson(r.query) ?? '{}';
    const sortOrder = asNum(r.sortOrder, 0);
    const incomingUpdated = asNum(r.updatedAt, now);
    const local = smartSetUpdated.get(id);
    if (local != null) {
      if (!shouldOverwrite(ctx, incomingUpdated, local)) {
        stats.smartSets.skipped += 1;
        continue;
      }
      updSmartSet.run(name, query, sortOrder, incomingUpdated, id);
      smartSetUpdated.set(id, incomingUpdated);
      stats.smartSets.updated += 1;
      continue;
    }
    insSmartSet.run(id, name, query, sortOrder, asNum(r.createdAt, now), incomingUpdated);
    smartSetUpdated.set(id, incomingUpdated);
    stats.smartSets.imported += 1;
  }

  // ---- providers：只导连接信息，密钥状态一律归零 ----
  const providerUpdated = updatedAtMap(db, 'providers');
  const insProvider = db.prepare(
    `INSERT INTO providers (id, name, type, base_url, model, has_key, key_suffix, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)`
  );
  const updProvider = db.prepare(
    `UPDATE providers SET name = ?, type = ?, base_url = ?, model = ?, updated_at = ? WHERE id = ?`
  );
  for (const r of arr(d.providers)) {
    const id = asStr(r.id);
    const name = asStr(r.name);
    const type = asStr(r.type);
    const baseUrl = asStr(r.baseUrl);
    const model = asStr(r.model);
    if (!id || !name || !type || !baseUrl || !model) {
      stats.providers.failed += 1;
      warn(ctx, '服务商缺少必填字段，已跳过');
      continue;
    }
    const incomingUpdated = asNum(r.updatedAt, now);
    const local = providerUpdated.get(id);
    if (local != null) {
      if (!shouldOverwrite(ctx, incomingUpdated, local)) {
        stats.providers.skipped += 1;
        continue;
      }
      // 覆盖也**不碰** has_key / key_suffix / is_active：
      // 本机可能已经配好了密钥，导入一份连接信息不该把它抹掉。
      updProvider.run(name, type, baseUrl, model, incomingUpdated, id);
      stats.providers.updated += 1;
      continue;
    }
    // has_key=0 / key_suffix=NULL 是**写死**的：导入端不可能有密钥，
    // 若照抄导出方的状态，UI 会显示"已配置"而实际调用必然 401。
    insProvider.run(
      id,
      name,
      type,
      baseUrl,
      model,
      asBoolInt(r.isActive),
      asNum(r.createdAt, now),
      incomingUpdated
    );
    providerUpdated.set(id, incomingUpdated);
    stats.providers.imported += 1;
    warn(ctx, `服务商「${name}」已导入，需要重新填写 API Key`);
  }

  // ---- history（仅当文件里带了；无 updated_at，冲突一律跳过）----
  const existingHistory = idSet(db, 'history');
  const insHistory = db.prepare(
    `INSERT INTO history
       (id, prompt_id, provider_id, model, prompt_text,
        negative_text, params, status, error_code, error_message, image_path, cost,
        cost_unit, duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insHistoryReference = db.prepare(
    `INSERT INTO history_prompt_references
       (history_id, prompt_id, prompt_title, excerpt, scope, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const r of arr(d.history)) {
    const id = asStr(r.id);
    const providerId = asStr(r.providerId);
    const model = asStr(r.model);
    const promptText = asStr(r.promptText);
    const status = asStr(r.status);
    if (!id || !providerId || !model || promptText == null || !status) {
      stats.history.failed += 1;
      continue;
    }
    if (existingHistory.has(id)) {
      stats.history.skipped += 1;
      continue;
    }
    const promptId = asStr(r.promptId);
    insHistory.run(
      id,
      promptId && existingPrompts.has(promptId) ? promptId : null,
      providerId,
      model,
      promptText,
      asStr(r.negativeText),
      asJson(r.params),
      status,
      asStr(r.errorCode),
      asStr(r.errorMessage),
      mapImagePath(ctx, asStr(r.imagePath)),
      asNullNum(r.cost),
      'point',
      asNullNum(r.durationMs),
      asNum(r.createdAt, now)
    );
    for (const [index, reference] of arr(r.promptReferences).entries()) {
      const title = asStr(reference.title);
      const text = asStr(reference.text);
      const scope = asStr(reference.scope);
      if (!title || text == null || (scope !== 'full' && scope !== 'excerpt')) {
        warn(ctx, `历史记录 ${id} 有无效的提示词引用，已跳过`);
        continue;
      }
      const referencePromptId = asStr(reference.promptId);
      insHistoryReference.run(
        id,
        referencePromptId && existingPrompts.has(referencePromptId) ? referencePromptId : null,
        title,
        text,
        scope,
        // The exported array is the canonical order. Re-number on import so a
        // malformed or hand-edited sortOrder cannot collide with the primary key.
        index,
      );
    }
    existingHistory.add(id);
    stats.history.imported += 1;
  }
}

/** 执行导入 */
export async function runImport(req: ImportRequest, sourcePath: string): Promise<ImportResult> {
  const strategy: ImportStrategy = req.strategy ?? 'merge';
  const dryRun = req.dryRun === true;

  const { envelope, images } = await loadEnvelope(sourcePath);
  const check = validateEnvelope(envelope);
  if (!check.ok) throw new Error(check.error);

  const db = getDb();
  const ctx: Ctx = { db, strategy, stats: zeroStats(), warnings: [], images };

  // replace 会删掉现有数据 —— 先落一份快照，出事还能回去。
  // 注意：replace **无视 autoBackup 入参一律备份**（doc 16 验收标准）；
  // merge/skip 也默认备份，只有显式 autoBackup:false 才跳过。
  let backupPath: string | undefined;
  if (!dryRun && (strategy === 'replace' || req.autoBackup !== false)) {
    backupPath = await createBackup(`import-${strategy}`);
  }

  if (dryRun) {
    // 试运行：照常在事务里跑一遍拿到真实计数，末尾主动抛错回滚。
    // 好处是"预览"和"真跑"共用同一段代码，不会出现预览说 10 条、
    // 实跑变 8 条这种两套逻辑不一致的经典问题。
    const SENTINEL = '__musefold_dry_run__';
    try {
      db.transaction(() => {
        applyEnvelope(ctx, envelope);
        throw new Error(SENTINEL);
      })();
    } catch (err) {
      if ((err as Error).message !== SENTINEL) throw err;
    }
  } else {
    db.transaction(() => applyEnvelope(ctx, envelope))();
    // FTS 是独立表、无触发器，上面的裸 INSERT 不会进索引 —— 必须显式重建，
    // 否则导入的提示词一条都搜不到（而且不报任何错）。
    const touchedPrompts = ctx.stats.prompts.imported + ctx.stats.prompts.updated;
    if (touchedPrompts > 0 || strategy === 'replace') {
      const n = promptsRepo.reindexFts();
      logger.info('导入后重建 FTS', `${n} 条`);
    }
  }

  const total = (k: keyof ImportTypeStat): number =>
    TYPES.reduce((sum, t) => sum + ctx.stats[t][k], 0);

  const result: ImportResult = {
    imported: total('imported'),
    updated: total('updated'),
    skipped: total('skipped'),
    failed: total('failed'),
    byType: ctx.stats,
    // 回传路径：对话框先 dryRun 预览、再拿这个路径确认，中途不会二次弹框
    sourcePath,
    source: {
      schemaVersion: envelope.schemaVersion,
      appVersion: envelope.appVersion ?? '未知',
      exportedAt: envelope.exportedAt ?? 0,
      mode: envelope.mode ?? 'db-only',
      counts: envelope.counts ?? ({} as ImportSourceInfo['counts']),
    },
    backupPath,
    warnings: ctx.warnings,
    dryRun,
  };

  logger.info(
    '导入完成',
    `strategy=${strategy}`,
    dryRun ? 'dryRun' : '',
    `imported=${result.imported}`,
    `updated=${result.updated}`,
    `skipped=${result.skipped}`,
    `failed=${result.failed}`
  );

  return result;
}
