'use client';

import { ConnectionsPanel, type ConnectionsPanelCopy } from './ConnectionsPanel';
import { AI_PROVIDER_HOOKS } from './hooks';

/** 生图 Provider 面板文案;testid 前缀 `ai-provider` 承既有 E2E / 单测。 */
export const AI_PROVIDER_PANEL_COPY: ConnectionsPanelCopy = {
  cardTestId: 'settings-ai-connections-card',
  itemTestIdPrefix: 'ai-provider',
  listTestId: 'ai-providers-list',
  emptyTestId: 'ai-providers-empty',
  title: 'AI 连接',
  description: '本地生图服务连接,密钥保存在系统安全存储',
  emptyText: '尚未配置 AI 连接。新建一个以启用本地生图。',
  editorTitleNew: '新建 AI 连接',
  editorTitleEdit: '编辑 AI 连接',
  modelPlaceholder: '如:gemini-2.5-flash-image',
  deleteDescription: '连接配置与其密钥将一并删除,不可恢复;已生成的图片不受影响。',
};

/**
 * AI 连接管理(桌面专属,V25-UI-SPEC §7.2):本地生图 Provider 的增删改、默认切换与测试。
 * 数据面走 gateway.aiProviders(SQLite providers 表 + 主进程 keychain)。
 */
export function AiConnectionsPanel() {
  return <ConnectionsPanel hooks={AI_PROVIDER_HOOKS} copy={AI_PROVIDER_PANEL_COPY} />;
}
