/**
 * 宿主能力 flags:宿主差异的唯一表达方式(不设登记制度,靠类型约束)。
 * features 组件按 flag 条件渲染,禁止用 userAgent / window.api 探测宿主。
 */
export interface PlatformCapabilities {
  host: 'desktop' | 'web';
  /** 能否在系统文件管理器中定位本地文件(桌面 true)。 */
  canRevealLocalFile: boolean;
  /** 是否有桌面云同步控制面(登录 ≠ 同步,桌面独立开关)。 */
  hasCloudSyncControls: boolean;
  /** 是否有本地 Agent 能力面(CLI / 本地 MCP / Automation)。 */
  hasLocalAutomation: boolean;
  /** 是否支持系统级窗口控制(标题栏、置顶等)。 */
  hasWindowChrome: boolean;
  /** 是否有本地生图 Provider 管理面(桌面 true;Web 生图凭据由云端账号托管)。 */
  hasLocalAiProviders: boolean;
}

export const DESKTOP_CAPABILITIES: PlatformCapabilities = {
  host: 'desktop',
  canRevealLocalFile: true,
  hasCloudSyncControls: true,
  hasLocalAutomation: true,
  hasWindowChrome: true,
  hasLocalAiProviders: true,
};

export const WEB_CAPABILITIES: PlatformCapabilities = {
  host: 'web',
  canRevealLocalFile: false,
  hasCloudSyncControls: false,
  hasLocalAutomation: false,
  hasWindowChrome: false,
  hasLocalAiProviders: false,
};
