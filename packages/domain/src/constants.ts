// 产品 / UI / 领域常量（与路径、文件系统无关）。

/** 与 `@musefold/desktop-contracts/enums` 的 TagGroup 同形；domain 不依赖 desktop-contracts。 */
type TagGroup = '风格' | '场景' | '模型' | '主体' | '画质' | '自定义';
/** 与 `@musefold/desktop-contracts/enums` 的 ProviderType 同形。 */
type ProviderType = 'openai' | 'openai-compatible' | 'doubao-web';
/** 与 `@musefold/desktop-contracts/enums` 的 ImageSize 同形。 */
type ImageSize = '1024x1024' | '1536x1024' | '1024x1536' | '2048x2048' | 'auto';

export const APP_NAME = 'Musefold';
/** Musefold v0.3.0 使用独立数据域，不读取旧品牌的数据与配置。 */
export const APP_DATA_NAMESPACE = 'v0.3.0';
/**
 * 版本化的本地草稿命名空间，只用于工作台这类可重建状态。
 * 主题、密度、侧栏折叠这类全局 UI 偏好仍保留在独立的稳定 key。
 */
export const LOCAL_STORAGE_PREFIX = `musefold:${APP_DATA_NAMESPACE}:`;

export const GITHUB_PRIVATE_SKILL_UNSUPPORTED_MESSAGE =
  '当前版本仅支持公开 GitHub 仓库。私有仓库请先下载到本机，再使用本地文件夹或 ZIP 导入；不要把 Token 写入地址。';

/** 默认 gpt-image model 字符串（用户可改） */
export const DEFAULT_MODEL = 'gpt-image-2';

/** 默认 Provider 配置示例 */
export const DEFAULT_PROVIDER = {
  baseUrl: 'https://api.openai.com/v1',
  model: DEFAULT_MODEL,
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
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'doubao-web',
    name: '豆包网页版（实验）',
    type: 'doubao-web',
    baseUrl: 'https://www.doubao.com/chat/create-image',
    model: 'seedream-4.5',
    hint: '使用独立浏览器会话登录豆包，后台模拟网页生图；登录失效或出现验证时会打开豆包窗口。',
    modelHint: '当前按豆包网页的 Seedream 4.5 生图入口运行；网页改版后可能需要更新适配。',
  },
  {
    id: 'tvt',
    name: 'TvT AI 中转站',
    type: 'openai-compatible',
    baseUrl: 'https://ai.tvt.wiki/v1',
    model: 'gpt-image-2',
    hint: '默认服务商 · OpenAI 兼容中转，生图用 gpt-image-2，出图快（约 10–30s）',
    keyUrl: 'https://ai.tvt.wiki/login/',
    recommended: true,
  },
];

/** 默认预设 id（新建 Provider 时选中） */
export const DEFAULT_PRESET_ID = 'tvt';

// ---------- v0.5 账号与云通道（V05-ARCHITECTURE §6.4） ----------

/** 官方账号服务器（Musefold Cloud，new-api）的主入口。 */
export const DEFAULT_ACCOUNT_SERVER_URL = 'https://zhaozhaoyue.top';

/** 给本地 Agent 读取的公开 Musefold 自动化 Skill；网站与设置页共用这个稳定地址。 */
export const MUSEFOLD_SKILL_VERSION = 'v0.4.0';
export const MUSEFOLD_SKILL_URL =
  `https://raw.githubusercontent.com/libai1024/Musefold-Skills/${MUSEFOLD_SKILL_VERSION}/skills/musefold/SKILL.md`;
export const MUSEFOLD_SKILL_MANIFEST_URL =
  'https://raw.githubusercontent.com/libai1024/Musefold-Skills/main/manifest.json';
/** 官方账号服务器的故障切换入口；只在主域名网络不可达或返回 5xx 时使用。 */
export const DEFAULT_ACCOUNT_SERVER_FALLBACK_URL = 'https://45.207.211.136';
/** 官方入口集合，用于识别官方地址并避免干扰用户自定义服务器。 */
export const DEFAULT_ACCOUNT_SERVER_URLS = [
  DEFAULT_ACCOUNT_SERVER_URL,
  DEFAULT_ACCOUNT_SERVER_FALLBACK_URL,
] as const;
/** 服务器别名模型（D6 契约）：默认模型由服务器渠道映射决定，改指向不发版。 */
export const ACCOUNT_DEFAULT_TEXT_MODEL = 'musefold-agent';
export const ACCOUNT_DEFAULT_IMAGE_MODEL = 'musefold-image-pro';
/** 别名缺失（自建 new-api 未配置）时的兜底模型 */
export const ACCOUNT_FALLBACK_TEXT_MODEL = 'gpt-5.4-mini';
export const ACCOUNT_FALLBACK_IMAGE_MODEL = 'gpt-image-2';
/** 托管记录展示名（两栈一致） */
export const ACCOUNT_MANAGED_NAME = 'Musefold 账号';

/**
 * 创作台「图片比例」选项：
 * - size：映射到 gpt-image-2 支持的像素档位（TvT / OpenAI 兼容）
 * - ratio：比例字符串（历史快照与自定义比例推导仍引用）
 */
export interface RatioOption {
  id: string;
  label: string;
  ratio: string;
  size: ImageSize; // OpenAI 像素档
  hint?: string;
}

export const RATIO_OPTIONS: RatioOption[] = [
  { id: '1:1', label: '方图', ratio: '1:1', size: '1024x1024', hint: '1:1' },
  { id: '2:3', label: '竖版', ratio: '2:3', size: '1024x1536', hint: '2:3' },
  { id: '3:4', label: '竖图', ratio: '3:4', size: '1024x1536', hint: '3:4' },
  { id: '3:2', label: '横版', ratio: '3:2', size: '1536x1024', hint: '3:2' },
  { id: '4:3', label: '横图', ratio: '4:3', size: '1536x1024', hint: '4:3' },
  { id: '4:5', label: '商品竖图', ratio: '4:5', size: '1024x1536', hint: '4:5' },
  { id: '5:4', label: '商品横图', ratio: '5:4', size: '1536x1024', hint: '5:4' },
  { id: '9:16', label: '手机竖屏', ratio: '9:16', size: '1024x1536', hint: '9:16' },
  { id: '16:9', label: '宽屏', ratio: '16:9', size: '1536x1024', hint: '16:9' },
  { id: '21:9', label: '超宽屏', ratio: '21:9', size: '1536x1024', hint: '21:9' },
  { id: 'auto', label: '自动', ratio: '1:1', size: 'auto', hint: '由模型决定' },
];

// ---------- 自定义比例（设置「默认比例」与 Composer 画幅共用） ----------
// ratioId 形如 `custom:W:H`（W/H 为 1–99 的整数），比例限制在 1:4 ~ 4:1。
// 语义与预设一致：ratio 保留比例语义；OpenAI 兼容站只有三档像素位，按纵横倾向就近映射。

export const CUSTOM_RATIO_LIMIT = 4;

/** 校验并解析 `custom:W:H`；越界/非法返回 null */
export function parseCustomRatioId(value: string | null | undefined): { w: number; h: number } | null {
  if (!value) return null;
  const match = /^custom:(\d{1,2}):(\d{1,2})$/.exec(value);
  if (!match) return null;
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (w < 1 || h < 1) return null;
  const ratio = w / h;
  if (ratio > CUSTOM_RATIO_LIMIT || ratio < 1 / CUSTOM_RATIO_LIMIT) return null;
  return { w, h };
}

/** 由 W:H 合成比例选项；像素档阈值取 1536/1024 档位比的几何中点（√1.5≈1.2247） */
export function customRatioOption(w: number, h: number): RatioOption {
  const ratio = w / h;
  const size: RatioOption['size'] =
    ratio >= 1.2247 ? '1536x1024' : ratio <= 1 / 1.2247 ? '1024x1536' : '1024x1024';
  return { id: `custom:${w}:${h}`, label: '自定义', ratio: `${w}:${h}`, size, hint: `${w}:${h}` };
}

/** ratioId → 选项（含自定义）；未知 id 回落到第一项（方图），不抛错 */
export function resolveRatioOptionById(value: string): RatioOption {
  const custom = parseCustomRatioId(value);
  if (custom) return customRatioOption(custom.w, custom.h);
  return RATIO_OPTIONS.find((option) => option.id === value) ?? RATIO_OPTIONS[0];
}

/** 预设标签组与示例标签（首次安装 seed，详见 docs/03 §1.2） */
export const SEED_TAG_GROUPS: { group: TagGroup; tags: string[] }[] = [
  { group: '风格', tags: ['二次元', '写实', '油画', '水彩', '3D渲染', '赛博朋克'] },
  { group: '场景', tags: ['头像', '壁纸', '海报', 'UI配图', '概念图'] },
  { group: '模型', tags: ['Midjourney v6', 'SDXL', 'Flux', 'DALL-E 3', 'gpt-image'] },
  { group: '主体', tags: ['人物', '风景', '物品', '抽象'] },
  { group: '画质', tags: ['高清', '稳定出图', '易崩坏'] },
];

/** 豆包网页桥接的保守本地硬限制；所有豆包 Provider 共享。 */
export const DOUBAO_WEB_DAILY_IMAGE_LIMIT = 10;

export const WORKBENCH_PROMPT_LIMIT = 8000;
export const MAX_SKILL_AI_INPUT_LENGTH = 120_000;

/** 防抖延迟 */
export const SEARCH_DEBOUNCE_MS = 150;

/**
 * 「未归档」哨兵值 —— ListPromptsQuery.folderId 传这个 = `folder_id IS NULL`。
 * folderId 是 string?，用 undefined 表示「不限文件夹」已经被占掉了，
 * 所以「只看未归档」需要一个不可能与 ULID 冲突的显式值。
 */
export const UNFILED_FOLDER_ID = '__unfiled__';

/** Token 计数阈值（颜色） */
export const TOKEN_THRESHOLDS = { green: 75, yellow: 150 };

/** 权重范围 */
export const WEIGHT_MIN = 0.1;
export const WEIGHT_MAX = 1.9;
