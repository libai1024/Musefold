// shared/constants.ts
// 路径名、默认值、预设数据

import type { TagGroup } from './types/enums';

export const APP_NAME = 'Musefold';
/** Musefold v0.3.0 使用独立数据域，不读取旧品牌的数据与配置。 */
export const APP_DATA_NAMESPACE = 'v0.3.0';
export const DB_NAME = `musefold-data-${APP_DATA_NAMESPACE}.db`;
export const STORE_NAME = `musefold-providers-${APP_DATA_NAMESPACE}`; // electron-store 文件名
/** 文本 AI 连接与图片 Provider 分开存储，避免模型、激活态和密钥串线。 */
export const AI_CONNECTION_STORE_NAME = `musefold-ai-connections-${APP_DATA_NAMESPACE}`;
/**
 * 版本化的本地草稿命名空间，只用于工作台这类可重建状态。
 * 主题、密度、侧栏折叠这类全局 UI 偏好仍保留在独立的稳定 key。
 */
export const LOCAL_STORAGE_PREFIX = `musefold:${APP_DATA_NAMESPACE}:`;
export const PICTURES_DIR_NAME = `Musefold/${APP_DATA_NAMESPACE}`;
export const BACKUPS_DIR_NAME = `musefold-backups-${APP_DATA_NAMESPACE}`;
export const PREVIEWS_DIR_NAME = `musefold-previews-${APP_DATA_NAMESPACE}`;
export const LOGS_DIR_NAME = `musefold-logs-${APP_DATA_NAMESPACE}`;

export const GITHUB_PRIVATE_SKILL_UNSUPPORTED_MESSAGE =
  '当前版本仅支持公开 GitHub 仓库。私有仓库请先下载到本机，再使用本地文件夹或 ZIP 导入；不要把 Token 写入地址。';

/** 默认 gpt-image model 字符串（用户可改） */
export const DEFAULT_MODEL = 'gpt-image-2';

/** 默认 Provider 配置示例 */
export const DEFAULT_PROVIDER = {
  baseUrl: 'https://api.openai.com/v1',
  model: DEFAULT_MODEL,
};

/** Provider 类型 */
import type { ProviderType } from './types/enums';

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
  /** model 字段在该 Provider 语义下的标签（如悟空为 product_id） */
  modelLabel?: string;
  modelHint?: string;
}

/**
 * 当前内置三种接入：
 * - 豆包网页版（实验，持久浏览器会话）
 * - TvT（默认，OpenAI 兼容，同步 b64_json）
 * - 悟空云 生图组（可选，异步 submit/poll，model 字段存 product_id）
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
  {
    id: 'wukong',
    name: '悟空云 · 生图组',
    type: 'wukong-studio',
    baseUrl: 'https://wkapi.vip/api/v1/studio',
    model: 'image_gptImage2',
    hint: '可选服务商 · 创作台生图组（异步出图）。Key 必须属于「生图组」分组。',
    keyUrl: 'https://wkapi.vip/wkapi-docs.html',
    modelLabel: '产品 ID',
    modelHint: 'GPT-Image-2 用 image_gptImage2；其余见 /catalog。',
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
/** 服务器计费换算：500000 quota = $1（new-api QuotaPerUnit） */
export const ACCOUNT_QUOTA_PER_USD = 500000;
/**
 * 用户侧显示单位「积分」：$1 按 ¥1 计费，¥1 = 10 积分。
 * 即 1 积分 = ¥0.1 = 50000 quota。展示层统一 quota ÷ 该常量。
 */
export const ACCOUNT_QUOTA_PER_POINT = ACCOUNT_QUOTA_PER_USD / 10;
/** 托管记录展示名（两栈一致） */
export const ACCOUNT_MANAGED_NAME = 'Musefold 账号';

/**
 * 创作台「图片比例」选项 —— 同时给两类 Provider 用：
 * - size：映射到 gpt-image-2 支持的像素档位（TvT / OpenAI 兼容）
 * - ratio：直接给悟空生图组 payload.size（比例字符串）
 */
export interface RatioOption {
  id: string;
  label: string;
  ratio: string; // 悟空 payload.size
  size: import('./types/enums').ImageSize; // OpenAI 像素档
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
// 语义与预设一致：ratio 原样给悟空；OpenAI 兼容站只有三档像素位，按纵横倾向就近映射。

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

/** FTS5 配置 */
export const FTS_TOKENIZE = 'unicode61';

/** 迁移相关 */
export const TARGET_DB_VERSION = 15;

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
