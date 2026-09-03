/**
 * 设计方案 Agent(Analyst / Compiler / Reviser)使用的文本模型适配器解析。
 *
 * v2.5 的 `providers` 表只登记生图连接(模型是 image model,不能当 chat/completions 用);
 * Agent 文本连接仍是 v2.1 保留的 `AiConnectionStore`(electron-store + keychain),与
 * Skill runtime / Automation 同源——v2.1 升级用户已配置的文本模型直接可用。
 * v2.5 尚无 Agent 连接配置 UI(V25-UI-SPEC §7.2 登记的范围缺口,U05);无可用连接时
 * 返回 null,由调用方给出结构化 blocker,不回落到生图连接伪装。
 */
import { getAiConnectionStore } from '../../ai/connection-store';
import { createLogger } from '../../system/logger';
import { OpenAiCompatibleTextAdapter } from './text-adapter';

export type ResolveAgentTextAdapter = () => OpenAiCompatibleTextAdapter | null;

const logger = createLogger('design-scheme-agent');

/** 活跃且有密钥的连接优先,否则任一有密钥的连接;读取密钥失败按不可用处理。 */
export function resolveDesktopAgentTextAdapter(): OpenAiCompatibleTextAdapter | null {
  const connections = getAiConnectionStore();
  const profiles = connections.list();
  const profile =
    profiles.find((item) => item.isActive && item.hasKey) ?? profiles.find((item) => item.hasKey);
  if (!profile) return null;
  try {
    return new OpenAiCompatibleTextAdapter({
      connection: profile,
      apiKey: connections.loadKey(profile.id),
    });
  } catch (error) {
    logger.warn('设计方案 Agent 读取文本连接密钥失败', error);
    return null;
  }
}
