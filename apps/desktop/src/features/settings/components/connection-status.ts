// 中转站列表行状态点：把「密钥配置 + 测试状态」映射为颜色语义。
// 色值只取 tokens.css 状态色：--success / --warning / --danger，未测试用三级边框灰。
// 数据模型没有「启用/禁用」字段，状态表达全部由状态点承载（RELAY-SETTINGS-UI 第一步）。

export type ConnectionDotTone = 'success' | 'warning' | 'danger' | 'muted';

export interface ConnectionDot {
  tone: ConnectionDotTone;
  /** a11y 文本：渲染为状态点的 title 与 sr-only 内容 */
  label: string;
}

/** 两个中转站 section 测试状态机的合集（生图 ok/failed/skipped，Agent success/failed） */
export type ConnectionTestState =
  | 'idle'
  | 'testing'
  | 'ok'
  | 'success'
  | 'failed'
  | 'skipped';

export function resolveConnectionDot({
  hasKey,
  keyAgnostic = false,
  testState,
}: {
  hasKey: boolean;
  /** doubao-web 等无密钥概念的类型：状态点只随测试状态走 */
  keyAgnostic?: boolean;
  testState?: ConnectionTestState;
}): ConnectionDot {
  if (!keyAgnostic && !hasKey) return { tone: 'warning', label: '缺少密钥' };
  switch (testState) {
    case 'ok':
    case 'success':
      return { tone: 'success', label: '测试通过' };
    case 'failed':
      return { tone: 'danger', label: '测试失败' };
    case 'skipped':
      return { tone: 'warning', label: '未配置密钥，已跳过测试' };
    case 'testing':
      return { tone: 'muted', label: '正在测试连接' };
    default:
      return { tone: 'muted', label: '未测试' };
  }
}
