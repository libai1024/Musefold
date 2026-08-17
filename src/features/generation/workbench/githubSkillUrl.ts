export interface GithubSkillSourceValue {
  repositoryUrl: string;
  requestedRef?: string;
  skillPath?: string;
  displayName: string;
}

export type GithubSkillUrlResult =
  | { ok: true; value: GithubSkillSourceValue }
  | { ok: false; error: string };

const GITHUB_SEGMENT = /^[A-Za-z0-9_.-]+$/;

function decodePathSegments(pathname: string): string[] | null {
  try {
    const segments = pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));
    return segments.some((segment) => segment === '.' || segment === '..') ? null : segments;
  } catch {
    return null;
  }
}

export function parseGithubSkillUrl(input: string): GithubSkillUrlResult {
  const value = input.trim();
  if (!value) return { ok: false, error: '请输入 GitHub Skill 地址' };
  if (value.length > 2048) return { ok: false, error: 'GitHub 地址过长' };
  try {
    const rawSegments = decodeURIComponent(value).split(/[?#]/, 1)[0].split('/');
    if (rawSegments.some((segment) => segment === '.' || segment === '..')) {
      return { ok: false, error: 'GitHub 地址不能包含越权路径' };
    }
  } catch {
    return { ok: false, error: 'GitHub 地址包含无效编码' };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: '请输入完整的 GitHub HTTPS 地址' };
  }

  if (url.username || url.password) {
    return { ok: false, error: 'GitHub 地址不能包含账号、密码或 Token' };
  }
  if (url.search || url.hash) {
    return { ok: false, error: 'GitHub 地址不能包含查询参数、Token 或页面锚点' };
  }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') {
    return { ok: false, error: '仅支持不含凭据和查询参数的 github.com HTTPS 地址' };
  }

  const segments = decodePathSegments(url.pathname);
  if (!segments || segments.length < 2) {
    return { ok: false, error: '地址中需要包含仓库所有者和仓库名' };
  }

  const owner = segments[0];
  const repository = segments[1].replace(/\.git$/i, '');
  if (!GITHUB_SEGMENT.test(owner) || !GITHUB_SEGMENT.test(repository) || !repository) {
    return { ok: false, error: '仓库所有者或仓库名格式不正确' };
  }

  const remainder = segments.slice(2);
  let requestedRef: string | undefined;
  let skillPath: string | undefined;

  if (remainder.length > 0) {
    const routeKind = remainder[0];
    if ((routeKind !== 'tree' && routeKind !== 'blob') || remainder.length < 2) {
      return { ok: false, error: '仅支持仓库首页、tree 目录或指向 SKILL.md 的 blob 地址' };
    }
    requestedRef = remainder[1];
    const sourcePath = remainder.slice(2);
    if (routeKind === 'blob') {
      if (sourcePath.at(-1)?.toLowerCase() !== 'skill.md') {
        return { ok: false, error: 'GitHub 文件地址必须指向 SKILL.md' };
      }
      sourcePath.pop();
    }
    if (sourcePath.length > 0) skillPath = sourcePath.join('/');
  }

  return {
    ok: true,
    value: {
      repositoryUrl: `https://github.com/${owner}/${repository}`,
      ...(requestedRef ? { requestedRef } : {}),
      ...(skillPath ? { skillPath } : {}),
      displayName: skillPath?.split('/').at(-1) || repository,
    },
  };
}
