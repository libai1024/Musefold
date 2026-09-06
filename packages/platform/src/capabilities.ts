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
  /** 是否有 Agent 文本模型连接管理面(桌面 true;Web 的 Agent 由云端账号托管,尚未闭合)。 */
  hasAgentConnections: boolean;
  /**
   * 是否已接入设计方案共享域；未接入时 UI 不注册方案入口。
   * 只在「gateway 适配器存在且有真实后端语义」的宿主置真。
   * Desktop 已部署 v25 单通道桥 18 个方法；Web 走云端 API 适配器：
   * 确定性 CRUD/详情/working-draft 可用，run/Agent 创建修改/市场/导入导出/资产
   * 由服务端结构化 501 fail-closed，UI 就地禁用并解释（I4），不伪造执行。
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
  hasAgentConnections: true,
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
  hasAgentConnections: false,
  hasDesignSchemes: true,
  hasDoubaoWebLogin: false,
};
