export interface DoubaoAccountNameCandidate {
  text: string;
  ariaLabel: string;
  title: string;
  left: number;
  top: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  tagName: string;
  avatarUrl: string;
  hasAvatar: boolean;
  interactive: boolean;
  conversationItem: boolean;
}

const RESERVED_LABELS = /^(登录|设置|更多|搜索|新对话|新工作任务|技能|AI 创作|云盘|主对话|下载电脑版)$/i;
const SEMANTIC_ACCOUNT_HINT = /(账号|账户|个人|头像|profile|account|user)/i;

export interface DoubaoAccountIdentity {
  accountName: string;
  avatarUrl: string | null;
}

function candidateLabel(candidate: DoubaoAccountNameCandidate): string | null {
  const lines = candidate.text
    .split(/\n+/)
    .map((line) => line.replace(/[>›⌄⌃]+$/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const label = lines.find((line) => (
    line.length <= 32
    && !RESERVED_LABELS.test(line)
    && !/^\d+$/.test(line)
  ));
  return label ?? null;
}

/**
 * 豆包没有稳定的公开账号 DOM 契约。账号入口长期位于左侧栏底部，
 * 因此用位置、交互语义和头像共同评分，避免依赖易变的 class 名。
 */
export function pickDoubaoAccount(candidates: DoubaoAccountNameCandidate[]): DoubaoAccountIdentity | null {
  let best: { label: string; avatarUrl: string | null; score: number } | null = null;

  for (const candidate of candidates) {
    const label = candidateLabel(candidate);
    if (!label) continue;
    const bottom = candidate.top + candidate.height;
    const leftRailWidth = Math.min(380, candidate.viewportWidth * 0.4);
    if (
      candidate.left < 0
      || candidate.left > leftRailWidth
      || bottom < candidate.viewportHeight * 0.68
      || bottom > candidate.viewportHeight
      || candidate.width < 24
      || candidate.width > 380
      || candidate.height < 20
      || candidate.height > 112
      || candidate.conversationItem
    ) continue;

    const semanticText = `${candidate.ariaLabel} ${candidate.title}`;
    const bottomDistance = Math.max(0, candidate.viewportHeight - bottom);
    const score = (
      (candidate.hasAvatar ? 32 : 0)
      + (candidate.interactive ? 14 : 0)
      + (candidate.tagName.toUpperCase() === 'BUTTON' ? 24 : 0)
      + (SEMANTIC_ACCOUNT_HINT.test(semanticText) ? 24 : 0)
      + Math.max(0, 28 - bottomDistance / 5)
      + Math.max(0, 10 - candidate.left / 24)
      + (label.length <= 16 ? 8 : 0)
    );

    if (!best || score > best.score) {
      best = {
        label,
        avatarUrl: isAllowedDoubaoAvatarUrl(candidate.avatarUrl) ? candidate.avatarUrl : null,
        score,
      };
    }
  }

  return best?.score && best.score >= 28
    ? { accountName: best.label, avatarUrl: best.avatarUrl }
    : null;
}

export function pickDoubaoAccountName(candidates: DoubaoAccountNameCandidate[]): string | null {
  return pickDoubaoAccount(candidates)?.accountName ?? null;
}

export function isAllowedDoubaoAvatarUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return [
      'byteacctimg.com',
      'byteimg.com',
      'doubao.com',
      'doubao.cn',
    ].some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}
