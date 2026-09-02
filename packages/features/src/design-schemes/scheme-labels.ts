import type {
  ConstraintDomain,
  ConstraintMode,
  DesignSchemeAsset,
  DesignSchemeSummary,
  ImageRole,
  InputKind,
  SourceKind,
  SourcePackageKind,
} from '@musefold/contracts';

/**
 * 方案域中文文案映射:逐字承 v2.1 `scheme-runtime-labels.ts`(ui-parity 06 §1 词汇表)。
 */
export const FIDELITY_LABEL: Record<string, string> = {
  verified: '已验证',
  faithful: '完整还原',
  adapted: '有取舍',
  unsupported: '暂不支持',
};

export const CONSTRAINT_DOMAIN_LABEL: Record<ConstraintDomain, string> = {
  composition: '构图',
  color: '色彩',
  typography: '文字',
  texture: '质感',
  subject: '主体',
  output: '输出',
  safety: '安全',
};

export const CONSTRAINT_MODE_LABEL: Record<ConstraintMode, string> = {
  required: '必须',
  preferred: '优先',
  avoid: '避免',
};

export const INPUT_KIND_LABEL: Record<InputKind, string> = {
  text: '文本',
  image: '图片',
  'image-set': '图组',
  article: '文章',
  choice: '选择',
};

export const IMAGE_ROLE_LABEL: Record<ImageRole, string> = {
  'edit-target': '待编辑主图',
  'subject-reference': '主体参考',
  'style-reference': '风格参考',
  'layout-reference': '版式参考',
  'content-reference': '内容参考',
};

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  'github-skill': 'GitHub Skill',
  'github-prompt-repo': 'GitHub 提示词仓库',
  'github-readme': 'GitHub README',
  'history-image': '历史图片',
  'conversation-turn': '历史对话',
  'user-brief': '用户想法',
  'reference-image': '参考图',
};

export const ASSET_ORIGIN_LABEL: Record<DesignSchemeAsset['origin'], string> = {
  repository: '仓库示例',
  'local-run': '本机生成',
};

export const PACKAGE_KIND_LABEL: Record<SourcePackageKind, string> = {
  github: 'GitHub 快照',
  history: '历史内容',
  'user-brief': '用户想法',
  'share-import': '分享包导入',
};

/** 契约时间戳是 epoch 毫秒或 ISO 字符串的并集;统一转 Date。 */
export function schemeTime(value: number | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 承旧 updatedLabel:zh-CN「M月D日 HH:mm」。 */
export function formatSchemeDateTime(value: number | string | null | undefined): string {
  const date = schemeTime(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

/** 承旧 marketUpdatedLabel:今天 / N 天前 / N 个月前 / N 年前更新。 */
export function marketUpdatedLabel(value: number | string, now = Date.now()): string {
  const date = schemeTime(value);
  if (!date) return '更新时间未知';
  const diff = Math.max(0, now - date.getTime());
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) return '今天更新';
  if (diff < day * 30) return `${Math.floor(diff / day)} 天前更新`;
  if (diff < day * 365) return `${Math.floor(diff / (day * 30))} 个月前更新`;
  return `${Math.floor(diff / (day * 365))} 年前更新`;
}

export interface SchemeLifecycle {
  label: string;
  detail: string;
  tone: 'ready' | 'pending';
}

/** 生命周期三态(承旧 lifecycleFor):正式方案 / 可继续 / 待试运行。 */
export function lifecycleFor(scheme: DesignSchemeSummary): SchemeLifecycle {
  if (scheme.status === 'formal') {
    return { label: '正式方案', detail: '已验证，可直接用于新设计', tone: 'ready' };
  }
  if (scheme.hasSuccessfulTrial) {
    return { label: '可继续', detail: '已有成功试运行，可继续完善', tone: 'ready' };
  }
  return { label: '待试运行', detail: '完成一次本机试运行后可转为正式方案', tone: 'pending' };
}

/** 行/详情主动作文案(承旧):正式=使用,有成功试运行的草稿=继续,新草稿=试运行。 */
export function schemeActionLabel(scheme: DesignSchemeSummary): string {
  if (scheme.status === 'formal') return '使用';
  return scheme.hasSuccessfulTrial ? '继续' : '试运行';
}

/** 新 revision id(客户端构造 update 文档用;opaque id 形状与契约一致)。 */
export function mintRevisionId(): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;
  return `rev-${random.slice(0, 24)}`;
}
