/**
 * 内容层 manifest 规范化序列化（跨语言可重现的协议要素）。
 *
 * 签名对象是「去掉 signature 字段后的规范化 JSON 的 UTF-8 字节」。
 * 本函数对任意 JSON 值生效，不依赖 schemaVersion，以便先验签再解析业务字段。
 *
 * 规则：
 * 1. 对象键按 UTF-16 码元序升序排列（与 ECMAScript `<` / `Array.prototype.sort()`
 *    对字符串的默认比较一致，不是 locale 序，也不是 UTF-8 字节序）。
 * 2. 数组保持原有顺序，不排序。
 * 3. 输出无多余空白：对象为 `{k:v,...}`，数组为 `[v,...]`，键与值之间只有一个冒号。
 * 4. 字符串、数字、布尔的编码与 `JSON.stringify` / ECMA-404 一致。
 * 5. `null` 必须保留，编码为 `null`；缺省（字段不存在）与 `null` 不相等。
 * 6. 拒绝非有限数（`NaN`、`±Infinity`）、`undefined`、bigint、function、symbol，
 *    以及 Date / Map / 类实例等非 JSON 值。空槽数组在遍历时会得到 `undefined`，同样拒绝。
 * 7. 循环引用拒绝。
 * 8. 最终以 UTF-8 编码为字节（`TextEncoder`）。
 *
 * 未知 surface、额外顶层字段若出现在输入对象中，会进入规范化字节；
 * 是否接受它们由 schema / 验签后的业务校验决定，本函数不做过滤。
 */
export class CanonicalizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalizeError';
  }
}

const encoder = new TextEncoder();

export function canonicalize(value: unknown): Uint8Array {
  return encoder.encode(canonicalizeValue(value, new WeakSet<object>()));
}

function canonicalizeValue(value: unknown, seen: WeakSet<object>): string {
  if (value === null) return 'null';
  if (value === undefined) {
    throw new CanonicalizeError('undefined is not a JSON value');
  }

  const valueType = typeof value;
  if (valueType === 'number') {
    if (!Number.isFinite(value)) {
      throw new CanonicalizeError('non-finite numbers are not allowed');
    }
    return JSON.stringify(value);
  }
  if (valueType === 'boolean' || valueType === 'string') {
    return JSON.stringify(value);
  }
  if (valueType !== 'object') {
    throw new CanonicalizeError('value is not JSON');
  }

  const objectValue = value as object;
  if (seen.has(objectValue)) {
    throw new CanonicalizeError('cyclic value is not allowed');
  }
  seen.add(objectValue);

  if (Array.isArray(value)) {
    const items: string[] = [];
    for (const item of value) {
      items.push(canonicalizeValue(item, seen));
    }
    seen.delete(objectValue);
    return `[${items.join(',')}]`;
  }

  if (!isPlainObject(value)) {
    throw new CanonicalizeError('value is not JSON');
  }

  const keys = Object.keys(value).sort();
  const parts: string[] = [];
  for (const key of keys) {
    parts.push(`${JSON.stringify(key)}:${canonicalizeValue(value[key], seen)}`);
  }
  seen.delete(objectValue);
  return `{${parts.join(',')}}`;
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}
