import { execFileSync } from 'node:child_process';

/** Documentation/report-only commits do not change tested build inputs. This
 * matches the migration's frozen-source scope, including tests and CI/config. */
const executionInput = (file: string): boolean =>
  /^(?:apps\/|packages\/|scripts\/|tests\/|tooling\/|infra\/|\.github\/|[^/]+\.(?:[cm]?[jt]sx?|json|ya?ml|toml)$|\.(?:npmrc|dockerignore|gitignore)$)/.test(
    file,
  );

export function assertEvidenceSourceCommit(repoRoot: string, commit: string): void {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commit)) {
    throw new Error('commit 必须是完整 Git commit SHA');
  }
  const git = (args: string[]) =>
    execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 32 * 1024 * 1024,
    });
  try {
    if (git(['rev-parse', '--verify', `${commit}^{commit}`]).trim() !== commit) {
      throw new Error('not an exact commit');
    }
    git(['merge-base', '--is-ancestor', commit, 'HEAD']);
  } catch {
    throw new Error('commit 已过期或不是当前分支可追溯的源码提交');
  }
  // Compare the recorded commit directly to both index and worktree. A clean
  // descendant with changed code is stale too; checking only dirty is unsafe.
  const changed = git(['diff', '--no-ext-diff', '--name-only', '--no-renames', '-z', commit, '--'])
    .split('\0')
    .filter(Boolean)
    .filter(executionInput);
  const staged = git([
    'diff',
    '--cached',
    '--no-ext-diff',
    '--name-only',
    '--no-renames',
    '-z',
    commit,
    '--',
  ])
    .split('\0')
    .filter(Boolean)
    .filter(executionInput);
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'])
    .split('\0')
    .filter(Boolean)
    .filter(executionInput);
  if (changed.length || staged.length || untracked.length) {
    throw new Error('commit 已过期：当前执行输入与已验证提交不同（含未提交或未跟踪源码）');
  }
}
