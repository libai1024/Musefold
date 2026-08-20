// 本地专属通道（V04-SECURITY §4.3）：Provider 写操作 / 备份 / 导出导入 / 删除
// 不进 v1 远程面——除 Bearer token 外，还要求「一次性文件质询」证明调用方
// 与所有者同机同用户（token 泄露也无法跨用户执行这些操作）。MCP 面不存在这些能力。
//
// 协议：POST /v1/local/challenge → { challengeId, fileName }；服务端在
// dataDir/.local-challenges/<fileName> 写入随机内容（0600，60s TTL，单次有效）；
// 调用方读取该文件并以头 `x-musefold-local-proof: <challengeId>:<内容>` 回证。

import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AutomationError, type AutomationRouteContext, type AutomationRouteHandler } from './server';
import { tokenEquals } from './token';

const CHALLENGE_DIR = '.local-challenges';
const CHALLENGE_TTL_MS = 60_000;

export interface LocalAdminOps {
  createProvider(input: { name: string; type: string; baseUrl: string; model: string; isActive?: boolean }): unknown;
  setProviderKey(providerId: string, apiKey: string): unknown;
  deleteProvider(providerId: string): unknown;
  setActiveProvider(providerId: string): unknown;
  validateProvider(providerId: string): Promise<unknown>;
  backupNow(): Promise<unknown>;
  listBackups(): Promise<unknown>;
  restoreBackup(file: string): Promise<unknown>;
  exportLibrary(request: Record<string, unknown>): Promise<unknown>;
  importLibrary(request: Record<string, unknown>): Promise<unknown>;
  deletePrompt(promptId: string): unknown;
}

export interface LocalRoutesResult {
  routes: Record<string, AutomationRouteHandler>;
}

export function createLocalRoutes(dataDir: string, ops: LocalAdminOps): LocalRoutesResult {
  const challenges = new Map<string, { content: string; expiresAt: number }>();
  const challengeDir = join(dataDir, CHALLENGE_DIR);

  const issueChallenge = () => {
    // 清理过期质询（文件 + 记录）
    const now = Date.now();
    for (const [id, entry] of challenges) {
      if (entry.expiresAt < now) {
        challenges.delete(id);
        rmSync(join(challengeDir, id), { force: true });
      }
    }
    const challengeId = randomUUID();
    const content = randomBytes(32).toString('base64url');
    mkdirSync(challengeDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(challengeDir, challengeId), content, { encoding: 'utf8', mode: 0o600 });
    challenges.set(challengeId, { content, expiresAt: now + CHALLENGE_TTL_MS });
    return { challengeId, fileName: join(CHALLENGE_DIR, challengeId) };
  };

  const requireProof = (context: AutomationRouteContext) => {
    const header = context.request.headers['x-musefold-local-proof'];
    const proof = Array.isArray(header) ? header[0] : header;
    const separator = proof?.indexOf(':') ?? -1;
    if (!proof || separator <= 0) {
      throw new AutomationError('LOCAL_PROOF_REQUIRED', '该操作仅限本机本人：请先完成本地质询（/v1/local/challenge）', 403);
    }
    const challengeId = proof.slice(0, separator);
    const provided = proof.slice(separator + 1);
    const entry = challenges.get(challengeId);
    challenges.delete(challengeId); // 单次有效：无论成败都消耗
    rmSync(join(challengeDir, challengeId), { force: true });
    if (!entry || entry.expiresAt < Date.now() || !tokenEquals(entry.content, provided)) {
      throw new AutomationError('LOCAL_PROOF_INVALID', '本地质询校验失败或已过期', 403);
    }
  };

  const guarded = (
    handler: (context: AutomationRouteContext) => unknown | Promise<unknown>,
  ): AutomationRouteHandler => async (context) => {
    requireProof(context);
    return handler(context);
  };

  const body = (context: AutomationRouteContext): Record<string, unknown> => {
    if (context.body == null) return {};
    if (typeof context.body !== 'object' || Array.isArray(context.body) || Buffer.isBuffer(context.body)) {
      throw new AutomationError('INVALID_PARAMS', '请求体必须是 JSON 对象', 400);
    }
    return context.body as Record<string, unknown>;
  };

  return {
    routes: {
      'POST /v1/local/challenge': () => issueChallenge(),

      'POST /v1/local/providers': guarded((context) => {
        const input = body(context);
        for (const field of ['name', 'type', 'baseUrl', 'model'] as const) {
          if (typeof input[field] !== 'string' || !input[field]) {
            throw new AutomationError('INVALID_PARAMS', `${field} 为必填`, 400);
          }
        }
        return ops.createProvider(input as never);
      }),
      'POST /v1/local/providers/:id/key': guarded((context) => {
        const { key } = body(context);
        if (typeof key !== 'string' || !key.trim()) throw new AutomationError('INVALID_PARAMS', 'key 为必填', 400);
        return ops.setProviderKey(context.params.id, key.trim());
      }),
      'DELETE /v1/local/providers/:id': guarded((context) => ops.deleteProvider(context.params.id)),
      'POST /v1/local/providers/:id/activate': guarded((context) => ops.setActiveProvider(context.params.id)),
      'POST /v1/local/providers/:id/validate': guarded((context) => ops.validateProvider(context.params.id)),

      'POST /v1/local/backups': guarded(() => ops.backupNow()),
      'GET /v1/local/backups': guarded(() => ops.listBackups()),
      'POST /v1/local/backups/restore': guarded((context) => {
        const { file } = body(context);
        if (typeof file !== 'string' || !file) throw new AutomationError('INVALID_PARAMS', 'file 为必填', 400);
        return ops.restoreBackup(file);
      }),

      'POST /v1/local/export': guarded((context) => ops.exportLibrary(body(context))),
      'POST /v1/local/import': guarded((context) => ops.importLibrary(body(context))),

      'DELETE /v1/local/prompts/:id': guarded((context) => ops.deletePrompt(context.params.id)),
    },
  };
}
