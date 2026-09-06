// v2.5 桌面 Agent 文本连接域桥:v2.1 保留的 AiConnectionStore(electron-store 元数据 + keychain 密钥)。
//
// 设计方案 Agent(Analyst / Compiler / Reviser)与 Skill runtime 都从这个 store 解析文本模型,
// 本域只是给它一个 v25 单通道桥的管理面;实体形状与生图 Provider 一致,`type` 恒为
// openai-compatible。密钥 write-only:渲染层只见 hasKey / keySuffix。

import type { AgentConnection } from '@musefold/contracts';
import {
  agentConnectionTestResultSchema,
  createAgentConnectionSchema,
  entityIdSchema,
  updateAgentConnectionSchema,
} from '@musefold/contracts';
import type { AiConnectionProfile } from '@musefold/desktop-contracts/ai';
import { z } from 'zod';
import { type AiConnectionStore, getAiConnectionStore } from '../../ai/connection-store';
import { BridgeError, type MethodDef } from './envelope';
import { probeProvider } from './providers-domain';

export interface AgentConnectionsDomainDeps {
  /** 连接 store;缺省懒取正式 electron-store 实例,测试注入内存实现。 */
  store?: AiConnectionStore;
  fetchImpl?: typeof fetch;
}

function epochMsToIso(ms: number): string {
  return new Date(ms).toISOString().replace(/Z$/, '+00:00');
}

export function toAgentConnection(profile: AiConnectionProfile): AgentConnection {
  return {
    id: profile.id,
    name: profile.name,
    type: profile.protocol,
    baseUrl: profile.baseUrl,
    model: profile.model,
    hasKey: profile.hasKey,
    keySuffix: profile.keySuffix ?? null,
    isActive: profile.isActive,
    managedBy: profile.managedBy === 'account' ? 'account' : null,
    createdAt: epochMsToIso(profile.createdAt),
    updatedAt: epochMsToIso(profile.updatedAt),
  };
}

/** store 的业务异常 → 稳定 BridgeError;账号托管连接只读、不存在、字段校验各自分码。 */
function mapStoreError(error: unknown): never {
  if (error instanceof BridgeError) throw error;
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    if (code === 'ACCOUNT/MANAGED_READONLY') {
      throw new BridgeError('AGENT_CONNECTION_MANAGED_READONLY', error.message);
    }
    if (error.message === 'AI 连接不存在') throw new BridgeError('NOT_FOUND', error.message);
    if (/Base URL|名称|模型 ID|API Key/.test(error.message)) {
      throw new BridgeError('VALIDATION_FAILED', error.message);
    }
    throw new BridgeError('INTERNAL_ERROR', error.message);
  }
  throw error;
}

const updatePayloadSchema = z.object({ id: entityIdSchema, patch: updateAgentConnectionSchema });

export function buildAgentConnectionsDomainMethods(
  deps: AgentConnectionsDomainDeps = {},
): Record<string, MethodDef> {
  const store = (): AiConnectionStore => deps.store ?? getAiConnectionStore();
  const guarded = <T>(run: () => T): T => {
    try {
      return run();
    } catch (error) {
      mapStoreError(error);
    }
  };

  return {
    'agentConnections.list': {
      input: z.undefined().or(z.object({}).strict()),
      handle: async () => {
        const profiles = store().list();
        // 默认连接置首,其余按 store 的更新时间序。
        return [...profiles.filter((p) => p.isActive), ...profiles.filter((p) => !p.isActive)].map(
          toAgentConnection,
        );
      },
    },
    'agentConnections.create': {
      input: createAgentConnectionSchema,
      handle: async (payload) => {
        const input = payload as z.infer<typeof createAgentConnectionSchema>;
        return guarded(() => {
          const created = store().create({
            name: input.name,
            routeKind: 'gateway',
            presetId: 'custom',
            baseUrl: input.baseUrl,
            model: input.model,
            isActive: input.activate,
          });
          if (input.apiKey) store().saveKey(created.id, input.apiKey);
          return toAgentConnection(store().require(created.id));
        });
      },
    },
    'agentConnections.update': {
      input: updatePayloadSchema,
      handle: async (payload) => {
        const { id, patch } = payload as z.infer<typeof updatePayloadSchema>;
        return guarded(() => {
          store().require(id);
          const metadata = {
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.baseUrl !== undefined ? { baseUrl: patch.baseUrl } : {}),
            ...(patch.model !== undefined ? { model: patch.model } : {}),
          };
          if (Object.keys(metadata).length > 0) store().update(id, metadata);
          if (typeof patch.apiKey === 'string') store().saveKey(id, patch.apiKey);
          else if (patch.apiKey === null) store().deleteKey(id);
          return toAgentConnection(store().require(id));
        });
      },
    },
    'agentConnections.remove': {
      input: z.object({ id: entityIdSchema }),
      handle: async (payload) => {
        const { id } = payload as { id: string };
        guarded(() => store().delete(id));
        return null;
      },
    },
    'agentConnections.setActive': {
      input: z.object({ id: entityIdSchema }),
      handle: async (payload) => {
        const { id } = payload as { id: string };
        return guarded(() => toAgentConnection(store().setActive(id)));
      },
    },
    'agentConnections.test': {
      input: z.object({ id: entityIdSchema }),
      handle: async (payload) => {
        const { id } = payload as { id: string };
        const profile = guarded(() => store().require(id));
        let apiKey: string | null = null;
        if (profile.hasKey) {
          try {
            apiKey = store().loadKey(id);
          } catch {
            apiKey = null;
          }
        }
        return agentConnectionTestResultSchema.parse(
          await probeProvider(profile.baseUrl, apiKey, deps.fetchImpl),
        );
      },
    },
  };
}
