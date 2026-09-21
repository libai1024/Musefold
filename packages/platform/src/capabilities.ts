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
  /**
   * 是否有本地 Agent 能力面:automation HTTP 控制面(开关/令牌/月度预算)、
   * 最近调用审计、接入向导,以及壳级花钱确认卡。
   * 桌面 true;Web false —— 浏览器里没有本机回环端口,也没有本地 CLI/MCP 产物。
   */
  hasLocalAutomation: boolean;
  /**
   * 是否有 Cloud MCP「已连接应用」控制面(授权列表 + 撤销)。
   * 双端 true(官方云)。自定义账号服务器不在这里置 false——由卡内读
   * 桌面域稳定码 `CLOUD_MCP_CUSTOM_SERVER` 显示「暂不支持」,避免再加宿主分支。
   */
  hasCloudMcpControls: boolean;
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
  /**
   * 是否有本机数据管理面:数据库备份 / 存储位置 / 诊断日志 / 危险区(清空全部数据)。
   * 桌面 true;Web false —— 云端有自己的备份纪律,浏览器也没有本机路径与本地库可清。
   * 「关于」卡不受此门控(双端都要能报版本),只是 Web 上没有 system 域可读版本。
   */
  hasLocalDataManagement: boolean;
  /**
   * 单次生成张数上限(§9-D3):Composer「张数」与设置「默认张数」按此门控,
   * 为 1 时两处控件都不渲染(不留死控件,D2 口径)。
   * 双端都是 4:桌面走 core `n`,云端由 worker 透传上游 `n` 并按 position 落 N 行资产,
   * 计费在上游按张扣减(服务端不做本地成本乘算)。
   */
  maxGenerationCount: 1 | 2 | 4;
}

export const DESKTOP_CAPABILITIES: PlatformCapabilities = {
  host: 'desktop',
  canRevealLocalFile: true,
  hasCloudSyncControls: true,
  hasLocalAutomation: true,
  hasCloudMcpControls: true,
  hasWindowChrome: true,
  hasLocalAiProviders: true,
  hasAgentConnections: true,
  hasDesignSchemes: true,
  hasDoubaoWebLogin: true,
  hasLocalDataManagement: true,
  maxGenerationCount: 4,
};

export const WEB_CAPABILITIES: PlatformCapabilities = {
  host: 'web',
  canRevealLocalFile: false,
  hasCloudSyncControls: false,
  hasLocalAutomation: false,
  hasCloudMcpControls: true,
  hasWindowChrome: false,
  hasLocalAiProviders: false,
  hasAgentConnections: false,
  hasDesignSchemes: true,
  hasDoubaoWebLogin: false,
  hasLocalDataManagement: false,
  maxGenerationCount: 4,
};
