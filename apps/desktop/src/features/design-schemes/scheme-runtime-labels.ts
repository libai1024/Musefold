import type { DesignSchemeAssetSummary, DesignSchemeSourceSnapshotDetail } from '@musefold/desktop-contracts/design-scheme';
import type {
  ConstraintDomain,
  ConstraintMode,
  ImageRole,
  InputKind,
  SourceKind,
} from '@musefold/desktop-contracts/design-scheme/schema';

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

export const ASSET_ORIGIN_LABEL: Record<DesignSchemeAssetSummary['origin'], string> = {
  'local-run': '本机生成',
  'repo-example': '仓库示例',
};

export const PACKAGE_KIND_LABEL: Record<DesignSchemeSourceSnapshotDetail['packageKind'], string> = {
  github: 'GitHub 快照',
  history: '历史内容',
  'user-brief': '用户想法',
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
