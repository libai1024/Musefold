import type Database from 'better-sqlite3';
import { providerSnapshotSchema, type ProviderSnapshot } from '@musefold/contracts';
import { BridgeError } from '../ipc-v25/envelope';

export interface DesktopDesignSchemeProviderRow {
  id: string;
  name: string;
  type: string;
  model: string;
}

function capabilitiesForProviderType(type: string): ProviderSnapshot['capabilities'] {
  if (type === 'openai' || type === 'openai-compatible') {
    return { text: true, vision: true, image: true, multiImage: true, editing: true };
  }
  if (type === 'doubao-web') {
    return { text: false, vision: false, image: true, multiImage: false, editing: false };
  }
  throw new BridgeError('DESIGN_SCHEME_PROVIDER_UNSUPPORTED', '当前 AI 连接类型不支持设计方案运行');
}

export function readDesktopDesignSchemeProvider(
  db: Database.Database,
  providerId: string,
): DesktopDesignSchemeProviderRow {
  const row = db
    .prepare('SELECT id, name, type, model FROM providers WHERE id = ?')
    .get(providerId) as DesktopDesignSchemeProviderRow | undefined;
  if (!row) {
    throw new BridgeError('DESIGN_SCHEME_PROVIDER_MISSING', '所选 AI 连接不存在，请重新选择');
  }
  return row;
}

export function toDesktopProviderSnapshot(row: DesktopDesignSchemeProviderRow): ProviderSnapshot {
  const parsed = providerSnapshotSchema.safeParse({
    providerId: row.id,
    providerName: row.name,
    model: row.model,
    providerVersion: null,
    capabilities: capabilitiesForProviderType(row.type),
  });
  if (!parsed.success) {
    throw new BridgeError('DESIGN_SCHEME_PROVIDER_INVALID', '所选 AI 连接配置无法用于方案运行');
  }
  return parsed.data;
}

export function sameDesktopProviderSnapshot(
  left: ProviderSnapshot,
  right: ProviderSnapshot,
): boolean {
  return (
    left.providerId === right.providerId &&
    left.providerName === right.providerName &&
    left.model === right.model &&
    left.providerVersion === right.providerVersion &&
    left.capabilities.text === right.capabilities.text &&
    left.capabilities.vision === right.capabilities.vision &&
    left.capabilities.image === right.capabilities.image &&
    left.capabilities.multiImage === right.capabilities.multiImage &&
    left.capabilities.editing === right.capabilities.editing
  );
}
