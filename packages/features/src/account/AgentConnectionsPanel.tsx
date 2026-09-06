'use client';

import { AGENT_CONNECTION_PRESETS } from './connection-presets';
import { ConnectionsPanel, type ConnectionsPanelCopy } from './ConnectionsPanel';
import { AGENT_CONNECTION_HOOKS } from './hooks';

/** Agent 文本模型连接面板文案;testid 前缀 `agent-connection`。 */
export const AGENT_CONNECTION_PANEL_COPY: ConnectionsPanelCopy = {
  cardTestId: 'settings-agent-connections-card',
  itemTestIdPrefix: 'agent-connection',
  listTestId: 'agent-connections-list',
  emptyTestId: 'agent-connections-empty',
  title: 'Agent 连接',
  description: '设计方案 Agent 使用的文本模型(chat/completions),密钥保存在系统安全存储',
  emptyText: '尚未配置 Agent 连接。新建一个文本模型连接以启用方案创建与修改。',
  editorTitleNew: '新建 Agent 连接',
  editorTitleEdit: '编辑 Agent 连接',
  modelPlaceholder: '如:gpt-5.4-mini / deepseek-chat',
  deleteDescription: '连接配置与其密钥将一并删除,不可恢复;已创建的方案不受影响。',
  presets: AGENT_CONNECTION_PRESETS,
};

/**
 * Agent 连接管理(桌面专属,V25-UI-SPEC §7.2):设计方案 Agent(Analyst / Compiler / Reviser)
 * 与 Skill runtime 共用的文本模型连接。数据面走 gateway.agentConnections(v2.1 保留的
 * AiConnectionStore),与生图 Provider 是两套并列的本地连接;默认连接即 Agent 实际使用的连接。
 */
export function AgentConnectionsPanel() {
  return <ConnectionsPanel hooks={AGENT_CONNECTION_HOOKS} copy={AGENT_CONNECTION_PANEL_COPY} />;
}
