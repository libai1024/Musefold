// 发现文件（V04-ARCHITECTURE §3.1）：userData/automation.json，0600，原子写。
// 所有者进程启动控制面成功后写入；退出时删除。客户端读它来发现端口与 token。

import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';

export const DISCOVERY_FILE_NAME = 'automation.json';

export interface DiscoveryDocument {
  version: 1;
  apiVersion: 'v1';
  pid: number;
  port: number;
  token: string;
  owner: 'desktop-app' | 'headless-daemon';
  appVersion: string;
  startedAt: string;
}

export function discoveryFilePath(dataDir: string): string {
  return join(dataDir, DISCOVERY_FILE_NAME);
}

export function writeDiscoveryFile(dataDir: string, document: DiscoveryDocument): string {
  mkdirSync(dataDir, { recursive: true });
  const target = discoveryFilePath(dataDir);
  const temp = `${target}.tmp-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temp, target); // 原子替换：读方永远看不到半个文件
  return target;
}

export function removeDiscoveryFile(dataDir: string): void {
  rmSync(discoveryFilePath(dataDir), { force: true });
}

/** 文件权限位（低 12 位）；文件不存在返回 null。加固清单要求启动时校验 0600。 */
export function discoveryFileMode(dataDir: string): number | null {
  try {
    return statSync(discoveryFilePath(dataDir)).mode & 0o777;
  } catch {
    return null;
  }
}

/** 读取并校验发现文件；格式非法（端口无效、字段缺失等）返回 null。 */
export function readDiscoveryFile(dataDir: string): DiscoveryDocument | null {
  let raw: string;
  try {
    raw = readFileSync(discoveryFilePath(dataDir), 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<DiscoveryDocument>;
    if (
      parsed.version !== 1 ||
      parsed.apiVersion !== 'v1' ||
      typeof parsed.pid !== 'number' || !Number.isInteger(parsed.pid) || parsed.pid <= 0 ||
      typeof parsed.port !== 'number' || !Number.isInteger(parsed.port) || parsed.port <= 0 || parsed.port > 65535 ||
      typeof parsed.token !== 'string' || parsed.token.length === 0 ||
      (parsed.owner !== 'desktop-app' && parsed.owner !== 'headless-daemon') ||
      typeof parsed.appVersion !== 'string' ||
      typeof parsed.startedAt !== 'string'
    ) {
      return null;
    }
    return parsed as DiscoveryDocument;
  } catch {
    return null;
  }
}

/**
 * 仅当文件仍归本实例所有（pid + port + token 三元组匹配）才删除。
 * 防止竞态下误删新所有者刚写入的发现文件（如快速重启）。
 */
export function removeDiscoveryFileIfOwned(
  dataDir: string,
  owner: { pid: number; port: number; token: string },
): boolean {
  const current = readDiscoveryFile(dataDir);
  if (!current) return false;
  if (current.pid !== owner.pid || current.port !== owner.port || current.token !== owner.token) {
    return false;
  }
  removeDiscoveryFile(dataDir);
  return true;
}
