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
  /**
   * 是否已接入设计方案共享域；未接入时 UI 不注册方案入口。
   * 只在「gateway 适配器存在且有真实后端语义」的宿主置真:
   * 桌面 = v25 单通道桥 16 方法 + staging/导入导出;Web = 云端确定性 CRUD
   * (run/市场/导入导出等未部署操作由客户端映射为可读不可用错误,入口禁用并解释)。
   */
  hasDesignSchemes: boolean;
  /** 是否有豆包网页登录面(桌面专属浏览器分区;Web 不展示豆包登录 UI)。 */
  hasDoubaoWebLogin: boolean;
}

export const DESKTOP_CAPABILITIES: PlatformCapabilities = {
  host: 'desktop',
  canRevealLocalFile: true,
  hasCloudSyncControls: true,
  hasLocalAutomation: true,
  hasWindowChrome: true,
  hasLocalAiProviders: true,
  hasDesignSchemes: true,
  hasDoubaoWebLogin: true,
};

export const WEB_CAPABILITIES: PlatformCapabilities = {
  host: 'web',
  canRevealLocalFile: false,
  hasCloudSyncControls: false,
  hasLocalAutomation: false,
  hasWindowChrome: false,
  hasLocalAiProviders: false,
  hasDesignSchemes: false,
  hasDoubaoWebLogin: false,
};
