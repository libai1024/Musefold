import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertEvidenceSourceCommit } from '../evidence-source-identity';

const owned: string[] = [];
afterEach(() => {
  for (const dir of owned.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function repository() {
  const dir = mkdtempSync(join(tmpdir(), 'musefold-evidence-identity-'));
  owned.push(dir);
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  const write = (name: string, text: string) => writeFileSync(join(dir, name), text);
  git('init', '--initial-branch=main');
  git('config', 'user.name', 'Synthetic evidence fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  mkdirSync(join(dir, 'apps'));
  mkdirSync(join(dir, 'docs'));
  mkdirSync(join(dir, 'tests'));
  write('apps/runtime.ts', 'export const value = 1;\n');
  write('tests/runtime.test.ts', '// original test\n');
  write('package.json', '{}\n');
  write('docs/report.json', '{}\n');
  git('add', '.');
  git('commit', '-m', 'fixture: initial input');
  const commit = git('rev-parse', 'HEAD');
  return { dir, git, write, commit };
}
describe('migration evidence source commit identity', () => {
  it('accepts the exact committed execution input', () => {
    const r = repository();
    expect(() => assertEvidenceSourceCommit(r.dir, r.commit)).not.toThrow();
  });
  it('accepts report edits and their descendant commit without a self-referential SHA', () => {
    const r = repository();
    r.write('docs/report.json', '{"result":"pass"}\n');
    expect(() => assertEvidenceSourceCommit(r.dir, r.commit)).not.toThrow();
    r.git('add', 'docs/report.json');
    r.git('commit', '-m', 'docs: register evidence');
    expect(() => assertEvidenceSourceCommit(r.dir, r.commit)).not.toThrow();
  });
  it.each(['apps/runtime.ts', 'tests/runtime.test.ts', 'package.json'])(
    'rejects an uncommitted change to %s',
    (file) => {
      const r = repository();
      r.write(file, 'changed\n');
      expect(() => assertEvidenceSourceCommit(r.dir, r.commit)).toThrow(/执行输入/);
      r.git('add', file);
      expect(() => assertEvidenceSourceCommit(r.dir, r.commit)).toThrow(/执行输入/);
    },
  );
  it('rejects new untracked execution input', () => {
    const r = repository();
    r.write('apps/new.ts', '// not verified\n');
    expect(() => assertEvidenceSourceCommit(r.dir, r.commit)).toThrow(/执行输入/);
  });
  it('rejects staged input hidden by restoring the worktree to the recorded bytes', () => {
    const r = repository();
    r.write('apps/runtime.ts', '// staged but not tested\n');
    r.git('add', 'apps/runtime.ts');
    r.write('apps/runtime.ts', 'export const value = 1;\n');
    expect(() => assertEvidenceSourceCommit(r.dir, r.commit)).toThrow(/执行输入/);
  });
  it('rejects a clean descendant with changed code', () => {
    const r = repository();
    r.write('apps/runtime.ts', '// new input\n');
    r.git('add', '.');
    r.git('commit', '-m', 'fixture: changed source');
    expect(() => assertEvidenceSourceCommit(r.dir, r.commit)).toThrow(/执行输入/);
  });
  it('rejects an unrelated branch commit even with identical source', () => {
    const r = repository();
    r.git('checkout', '-b', 'other');
    r.write('docs/other.md', 'other\n');
    r.git('add', '.');
    r.git('commit', '-m', 'docs: another branch');
    const other = r.git('rev-parse', 'HEAD');
    r.git('checkout', 'main');
    expect(() => assertEvidenceSourceCommit(r.dir, other)).toThrow(/可追溯/);
  });
  it('fails closed for a missing commit, abbreviated commit or missing repository', () => {
    const r = repository();
    expect(() => assertEvidenceSourceCommit(r.dir, '0'.repeat(40))).toThrow(/commit/);
    expect(() => assertEvidenceSourceCommit(r.dir, r.commit.slice(0, 7))).toThrow(/完整/);
    expect(() => assertEvidenceSourceCommit(join(r.dir, 'missing'), r.commit)).toThrow(/commit/);
  });
});
