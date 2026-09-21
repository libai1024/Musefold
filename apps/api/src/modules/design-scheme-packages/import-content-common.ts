import { DESIGN_SCHEME_PACKAGE_LIMITS } from '@musefold/contracts';
import { inspectSchemeImage } from '../design-scheme-assets/image.js';

export function requireMapping(mapping: Map<string, string>, original: string) {
  const value = mapping.get(original);
  if (!value) throw new Error('方案包包含无法映射的实体引用');
  return value;
}

export function requireBytes(entries: Map<string, Buffer>, path: string) {
  const bytes = entries.get(path);
  if (!bytes) throw new Error('方案包缺少完整内容');
  return bytes;
}

export function inspectImportImage(bytes: Uint8Array) {
  return inspectSchemeImage(bytes, { maxBytes: DESIGN_SCHEME_PACKAGE_LIMITS.entryBytes });
}
