import { describe, expect, it } from 'vitest';
import { buildBuilderArgs } from '../../scripts/run-builder.mjs';

const options = {
  configPath: '/repo/apps/desktop/electron-builder.yml',
  afterPack: '/repo/scripts/after-pack.cjs',
};

describe('run-builder 参数组装(Windows 工作区根探测缺陷的 afterPack 绝对路径注入)', () => {
  it('默认配置:追加 --config <yml> 与绝对路径 afterPack 点号覆盖', () => {
    expect(buildBuilderArgs(['--win', '--dir'], options)).toEqual([
      '--config',
      options.configPath,
      `--config.afterPack=${options.afterPack}`,
      '--win',
      '--dir',
    ]);
  });

  it('用户自带 --config(含 = 形式与 -c 别名)时原样透传,不注入默认值', () => {
    const custom = ['--config', '/elsewhere/builder.yml'];
    expect(buildBuilderArgs(custom, options)).toBe(custom);
    expect(buildBuilderArgs(['--config=/elsewhere/builder.yml'], options)).toEqual([
      '--config=/elsewhere/builder.yml',
    ]);
    expect(buildBuilderArgs(['-c', '/elsewhere/builder.yml'], options)).toEqual([
      '-c',
      '/elsewhere/builder.yml',
    ]);
  });

  it('用户点号键(--config.key=v)不算自带配置文件:仍注入 yml,且用户键在后、可覆盖注入值', () => {
    const userDot = ['--config.afterPack=/custom/other.cjs'];
    const args = buildBuilderArgs(userDot, options);
    expect(args).toEqual(['--config', options.configPath, `--config.afterPack=${options.afterPack}`, ...userDot]);
  });

  it('afterPack 路径含空格时加引号,避免 win32 shell:true 拆词', () => {
    const args = buildBuilderArgs([], {
      configPath: options.configPath,
      afterPack: '/repo with space/scripts/after-pack.cjs',
    });
    expect(args[2]).toBe('--config.afterPack="/repo with space/scripts/after-pack.cjs"');
  });
});
