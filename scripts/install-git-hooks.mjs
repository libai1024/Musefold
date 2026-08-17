#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

try {
  const inside = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  if (inside === 'true') {
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' });
    console.log('[git-hooks] 已启用 .githooks（包含 Skill 更新强制检查）');
  }
} catch {
  console.log('[git-hooks] 当前不是 Git 工作树，跳过 hook 安装');
}
