// packages/domain/src/export-format.ts
// 导出信封的**格式契约** —— 导出端与导入端共同的唯一事实来源。
//
// 为什么单独成文件而不放在 electron/system/export.ts：
//   1. 导入端需要这些常量做校验。让 import.ts 去 import export.ts 会造成
//      「导入依赖导出」这种反直觉的耦合，两边都还得拖上 better-sqlite3。
//   2. 这里零依赖，vitest 能直接跑（主进程那两个模块因为 better-sqlite3 是按
//      Electron ABI 编译的，在 Node 下 dlopen 就失败，只能走 E2E）。

/** 信封魔数。导入端第一道闸门就是它 —— 用户选错文件的概率远高于文件损坏。 */
export const EXPORT_FORMAT = 'musefold-export';

/**
 * 信封版本。**升级规则**：
 * - 只加可选字段 → 不动版本号（旧端读新文件时忽略未知字段即可）
 * - 改字段语义 / 删字段 / 加必填字段 → +1，并在 validateEnvelope 里写好降级路径
 */
export const EXPORT_SCHEMA_VERSION = 3;

/** zip 模式里导出 JSON 的固定名字；导入端据此在包内定位 */
export const EXPORT_JSON_NAME = 'musefold-export.json';

/** zip 模式里图片的存放目录 */
export const EXPORT_IMAGES_DIR = 'previews';

export type EnvelopeCheck = { ok: true } | { ok: false; error: string };

/**
 * data 下的分段名。validateEnvelope 用它逐个检查形状。
 *
 * 只检查已知分段：未知键一律放过，这样将来加分段的旧版应用不会把新文件判成损坏
 * （向后兼容靠这个，向前不兼容已由 schemaVersion 闸门硬拒）。
 */
const ENVELOPE_SECTIONS = [
  'prompts',
  'folders',
  'tags',
  'smartSets',
  'providers',
  'history',
] as const;

/**
 * 信封校验。**先看顶层元数据再看 data** —— 用户很可能选错文件（挑了张图、
 * 挑了别的 app 的备份），这时候要给「这不是 Musefold 导出文件」，
 * 而不是一串 undefined 的属性访问错误。
 */
export function validateEnvelope(env: unknown): EnvelopeCheck {
  if (env == null || typeof env !== 'object' || Array.isArray(env)) {
    return { ok: false, error: '文件内容不是一个对象，可能选错了文件' };
  }
  const e = env as Record<string, unknown>;

  if (e.format !== EXPORT_FORMAT) {
    return { ok: false, error: '这不是 Musefold 导出文件（format 不匹配）' };
  }
  if (typeof e.schemaVersion !== 'number' || !Number.isFinite(e.schemaVersion)) {
    return { ok: false, error: '导出文件缺少 schemaVersion，无法判断版本' };
  }
  if (e.schemaVersion > EXPORT_SCHEMA_VERSION) {
    // 向后兼容能做，向前兼容做不到：新版写的字段这版根本不认识。
    // 硬拒比"尽力读一半"安全 —— 后者会静默丢数据。
    return {
      ok: false,
      error: `文件由更新版本的 Musefold 导出（格式版本 ${e.schemaVersion}，本机支持 ${EXPORT_SCHEMA_VERSION}），请先升级应用`,
    };
  }
  if (e.schemaVersion < EXPORT_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `旧版数据格式 ${e.schemaVersion} 不再导入；请先使用对应版本完成升级`,
    };
  }
  if (e.data == null || typeof e.data !== 'object' || Array.isArray(e.data)) {
    return { ok: false, error: '导出文件缺少 data 段' };
  }

  // 每个存在的分段都必须是数组。
  //
  // 少了这一道会**静默丢数据**：导入端取分段用的是
  // `Array.isArray(v) ? … : []`，于是 `prompts: { "0": {…} }`（手改过的文件、
  // 别的工具生成的、JSON 序列化时把稀疏数组变成了对象）会被当成"零条提示词"，
  // 导入报告一片 0、没有任何警告，用户以为备份是空的 —— 最坏的失败形态，
  // 因为它看起来像成功。宁可在门口硬拒。
  const data = e.data as Record<string, unknown>;
  for (const k of ENVELOPE_SECTIONS) {
    const v = data[k];
    if (v !== undefined && !Array.isArray(v)) {
      return { ok: false, error: `导出文件的 data.${k} 不是数组，文件可能已损坏` };
    }
  }
  return { ok: true };
}

/**
 * providers 段**允许出现**的字段白名单。
 *
 * 导出端按它裁剪，测试端按它断言。列在这里之外的一律不得出现 ——
 * 尤其 apiKey / has_key / hasKey / keySuffix：前者是密钥本体，
 * 后两者会暗示"这个站配过密钥、末四位是 xxxx"，是白送的信息面。
 * 见 docs/product/16 §4.7 红线。
 */
export const PROVIDER_EXPORT_FIELDS = [
  'id',
  'name',
  'type',
  'baseUrl',
  'model',
  'isActive',
  'createdAt',
  'updatedAt',
] as const;

/** 任何情况下都不得出现在导出产物里的 key（大小写/下划线变体全列） */
export const FORBIDDEN_EXPORT_KEYS = [
  'apiKey',
  'api_key',
  'apikey',
  'hasKey',
  'has_key',
  'keySuffix',
  'key_suffix',
  'encryptedKey',
  'encrypted_key',
  'secret',
  'token',
] as const;
