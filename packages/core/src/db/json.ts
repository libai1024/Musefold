// electron/db/json.ts
// TEXT 列里 JSON 的容错解析。
//
// 为什么需要它：schema 里 params / slots / slot_fills / tags / compatible_models
// 都是存 JSON 的 TEXT 列。在导入功能出现之前，这些列的唯一写入方是本应用，
// 内容永远合法，于是各 repository 里的 `JSON.parse(r.params)` 都是裸的。
//
// 导入把「文件里的任意字符串」变成了新的写入源。写入侧现在有闸门
// （electron/system/import.ts 的 asJson 会验证再落库），但那只保护此后的写入：
// 已经被旧版本导入进来的脏数据、手工改过的库、磁盘位翻转，都还能让读路径抛。
//
// 而读路径抛的后果极不对称：rowToPrompt 是 list/get/search 共用的映射器，
// **一条坏 params 会让整个资源库视图打不开，且用户在 UI 上无法自救**。
// 用「这一条的这个字段降级为默认值」换「整个视图能打开」，是明显划算的交易。

/**
 * 解析 TEXT 列里的 JSON；失败时返回 fallback。
 *
 * 只接受对象/数组结果 —— 列里存的本来就是对象或数组，
 * 若解析出 `"abc"`、`42`、`null` 这类标量，同样按脏数据处理。
 */
export function parseJsonColumn<T>(raw: unknown, fallback: T): T {
  if (raw == null || raw === '') return fallback;
  if (typeof raw !== 'string') return fallback;
  try {
    const v: unknown = JSON.parse(raw);
    return v != null && typeof v === 'object' ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}
