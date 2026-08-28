/** 与 `@musefold/desktop-contracts/enums` 的 TagGroup 同形；domain 不依赖 desktop-contracts。 */
type TagGroup = '风格' | '场景' | '模型' | '主体' | '画质' | '自定义';
/** 与 `@musefold/desktop-contracts/enums` 的 ProviderType 同形。 */
type ProviderType = 'openai' | 'openai-compatible' | 'doubao-web';
/** 与 `@musefold/desktop-contracts/enums` 的 ImageSize 同形。 */
type ImageSize = '1024x1024' | '1536x1024' | '1024x1536' | '2048x2048' | 'auto';
export declare const APP_NAME = 'Musefold';
/** Musefold v0.3.0 使用独立数据域，不读取旧品牌的数据与配置。 */
export declare const APP_DATA_NAMESPACE = 'v0.3.0';
/**
 * 版本化的本地草稿命名空间，只用于工作台这类可重建状态。
 * 主题、密度、侧栏折叠这类全局 UI 偏好仍保留在独立的稳定 key。
 */
export declare const LOCAL_STORAGE_PREFIX = 'musefold:v0.3.0:';
export declare const GITHUB_PRIVATE_SKILL_UNSUPPORTED_MESSAGE =
  '\u5F53\u524D\u7248\u672C\u4EC5\u652F\u6301\u516C\u5F00 GitHub \u4ED3\u5E93\u3002\u79C1\u6709\u4ED3\u5E93\u8BF7\u5148\u4E0B\u8F7D\u5230\u672C\u673A\uFF0C\u518D\u4F7F\u7528\u672C\u5730\u6587\u4EF6\u5939\u6216 ZIP \u5BFC\u5165\uFF1B\u4E0D\u8981\u628A Token \u5199\u5165\u5730\u5740\u3002';
/** 默认 gpt-image model 字符串（用户可改） */
export declare const DEFAULT_MODEL = 'gpt-image-2';
/** 默认 Provider 配置示例 */
export declare const DEFAULT_PROVIDER: {
  baseUrl: string;
  model: string;
};
/** 一键接入预设 —— 填好 baseUrl/model，用户仅需粘贴 API Key（密钥不入库、系统级加密存储） */
export interface ProviderPreset {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  model: string;
  /** 面向用户的说明 */
  hint: string;
  /** 获取密钥的链接（可选） */
  keyUrl?: string;
  /** 是否推荐（默认服务商） */
  recommended?: boolean;
  /** model 字段在该 Provider 语义下的标签 */
  modelLabel?: string;
  modelHint?: string;
}
/**
 * 当前内置两种接入：
 * - 豆包网页版（实验，持久浏览器会话）
 * - TvT（默认，OpenAI 兼容，同步 b64_json）
 */
export declare const PROVIDER_PRESETS: ProviderPreset[];
/** 默认预设 id（新建 Provider 时选中） */
export declare const DEFAULT_PRESET_ID = 'tvt';
/** 官方账号服务器（Musefold Cloud，new-api）的主入口。 */
export declare const DEFAULT_ACCOUNT_SERVER_URL = 'https://zhaozhaoyue.top';
/** 给本地 Agent 读取的公开 Musefold 自动化 Skill；网站与设置页共用这个稳定地址。 */
export declare const MUSEFOLD_SKILL_VERSION = 'v0.4.0';
export declare const MUSEFOLD_SKILL_URL =
  'https://raw.githubusercontent.com/libai1024/Musefold-Skills/v0.4.0/skills/musefold/SKILL.md';
export declare const MUSEFOLD_SKILL_MANIFEST_URL =
  'https://raw.githubusercontent.com/libai1024/Musefold-Skills/main/manifest.json';
/** 官方账号服务器的故障切换入口；只在主域名网络不可达或返回 5xx 时使用。 */
export declare const DEFAULT_ACCOUNT_SERVER_FALLBACK_URL = 'https://45.207.211.136';
/** 官方入口集合，用于识别官方地址并避免干扰用户自定义服务器。 */
export declare const DEFAULT_ACCOUNT_SERVER_URLS: readonly [
  'https://zhaozhaoyue.top',
  'https://45.207.211.136',
];
/** 服务器别名模型（D6 契约）：默认模型由服务器渠道映射决定，改指向不发版。 */
export declare const ACCOUNT_DEFAULT_TEXT_MODEL = 'musefold-agent';
export declare const ACCOUNT_DEFAULT_IMAGE_MODEL = 'musefold-image-pro';
/** 别名缺失（自建 new-api 未配置）时的兜底模型 */
export declare const ACCOUNT_FALLBACK_TEXT_MODEL = 'gpt-5.4-mini';
export declare const ACCOUNT_FALLBACK_IMAGE_MODEL = 'gpt-image-2';
/** 托管记录展示名（两栈一致） */
export declare const ACCOUNT_MANAGED_NAME = 'Musefold \u8D26\u53F7';
/**
 * 创作台「图片比例」选项：
 * - size：映射到 gpt-image-2 支持的像素档位（TvT / OpenAI 兼容）
 * - ratio：比例字符串（历史快照与自定义比例推导仍引用）
 */
export interface RatioOption {
  id: string;
  label: string;
  ratio: string;
  size: ImageSize;
  hint?: string;
}
export declare const RATIO_OPTIONS: RatioOption[];
export declare const CUSTOM_RATIO_LIMIT = 4;
/** 校验并解析 `custom:W:H`；越界/非法返回 null */
export declare function parseCustomRatioId(value: string | null | undefined): {
  w: number;
  h: number;
} | null;
/** 由 W:H 合成比例选项；像素档阈值取 1536/1024 档位比的几何中点（√1.5≈1.2247） */
export declare function customRatioOption(w: number, h: number): RatioOption;
/** ratioId → 选项（含自定义）；未知 id 回落到第一项（方图），不抛错 */
export declare function resolveRatioOptionById(value: string): RatioOption;
/** 预设标签组与示例标签（首次安装 seed，详见 docs/03 §1.2） */
export declare const SEED_TAG_GROUPS: {
  group: TagGroup;
  tags: string[];
}[];
/** 豆包网页桥接的保守本地硬限制；所有豆包 Provider 共享。 */
export declare const DOUBAO_WEB_DAILY_IMAGE_LIMIT = 10;
export declare const WORKBENCH_PROMPT_LIMIT = 8000;
export declare const MAX_SKILL_AI_INPUT_LENGTH = 120000;
/** 防抖延迟 */
export declare const SEARCH_DEBOUNCE_MS = 150;
/**
 * 「未归档」哨兵值 —— ListPromptsQuery.folderId 传这个 = `folder_id IS NULL`。
 * folderId 是 string?，用 undefined 表示「不限文件夹」已经被占掉了，
 * 所以「只看未归档」需要一个不可能与 ULID 冲突的显式值。
 */
export declare const UNFILED_FOLDER_ID = '__unfiled__';
/** Token 计数阈值（颜色） */
export declare const TOKEN_THRESHOLDS: {
  green: number;
  yellow: number;
};
/** 权重范围 */
export declare const WEIGHT_MIN = 0.1;
export declare const WEIGHT_MAX = 1.9;
//# sourceMappingURL=constants.d.ts.map
