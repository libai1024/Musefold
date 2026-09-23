import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../../tooling/aliases.mjs';
import { extractUpSource, lintMigrationSource } from '../../scripts/deploy/expand-contract.mjs';

describe('expand/contract lint', () => {
  it('inspects only exports.up', () => {
    const source = `
exports.up = (pgm) => { pgm.sql('ALTER TABLE t ADD COLUMN x int'); };
exports.down = (pgm) => { pgm.sql('ALTER TABLE t DROP COLUMN x; UPDATE t SET y = 1'); };
`;
    expect(lintMigrationSource(source).ok).toBe(true);
    expect(extractUpSource(source)).not.toMatch(/DROP COLUMN x/);
  });

  it('rejects an up() that writes rows and drops a column', () => {
    const source = `
exports.up = (pgm) => {
  pgm.sql('UPDATE t SET x = 1; ALTER TABLE t DROP COLUMN y');
};
`;
    expect(lintMigrationSource(source, '000099.cjs').ok).toBe(false);
  });
});

describe('layer detection', () => {
  it('keeps detect-layers self-test green', () => {
    const result = spawnSync(
      process.execPath,
      ['.github/scripts/detect-layers.mjs', '--self-test'],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      },
    );
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || 'detect-layers self-test failed');
    }
    expect(result.stdout).toContain('infra/v1.1 Dockerfile is infra');
  });
});

// v1.1 部署流水线已于 v2.5.1 退役(infra/v1.1 与 apps/web 均已删除,脚本不可用)。
// 这里守卫退役状态本身,防止入口或脚本被误恢复;v1.1 专属的编排测试随脚本一并移除,
// 仍存活模块(expand-contract、detect-layers)的测试保留在上面的 describe 中。
describe('v1.1 deploy retirement guard', () => {
  const RETIRED_FILES = [
    'run.mjs',
    'rollback.mjs',
    'state.mjs',
    'web-release.mjs',
    'infra-guard.mjs',
    'bootstrap-runner.sh',
  ];

  it('package.json no longer exposes v1.1 deploy entry points', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['deploy:prod']).toBeUndefined();
    expect(pkg.scripts['deploy:rollback']).toBeUndefined();
    expect(pkg.scripts['deploy:v25:plan']).toBe('node scripts/deploy/v25-plan.mjs');
  });

  it('retired v1.1 pipeline files are absent from scripts/deploy', () => {
    for (const file of RETIRED_FILES) {
      expect(existsSync(join(REPO_ROOT, 'scripts/deploy', file)), file).toBe(false);
    }
  });

  it('no remaining deploy script still references the retired modules', () => {
    const offenders: string[] = [];
    const deployDir = join(REPO_ROOT, 'scripts/deploy');
    for (const entry of readdirSync(deployDir)) {
      if (!entry.endsWith('.mjs')) continue;
      const source = readFileSync(join(deployDir, entry), 'utf8');
      if (/(run|rollback|state|web-release|infra-guard)\.mjs/.test(source)) {
        offenders.push(entry);
      }
    }
    expect(offenders).toEqual([]);
  });
});
