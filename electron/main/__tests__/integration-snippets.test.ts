import { describe, expect, it } from 'vitest';
import {
  claudeCodeAddCommand,
  cliShimPosix,
  cliShimWindows,
  codexConfigSnippet,
  cursorConfigSnippet,
  cursorInstallDeeplink,
  mcpLaunchSpec,
  type IntegrationPaths,
} from '../integration-snippets';

const paths: IntegrationPaths = {
  execPath: '/Applications/Musefold.app/Contents/MacOS/Musefold',
  mcpScriptPath: '/Applications/Musefold.app/Contents/Resources/integration/musefold-mcp.mjs',
  cliScriptPath: '/Applications/Musefold.app/Contents/Resources/integration/musefold-cli.mjs',
  nodeModulesPath: '/Applications/Musefold.app/Contents/Resources/app.asar.unpacked/node_modules',
};

describe('客户端接入片段（零依赖 · 无密钥）', () => {
  it('启动规格：App 自身可执行文件 + ELECTRON_RUN_AS_NODE', () => {
    const spec = mcpLaunchSpec(paths);
    expect(spec.command).toBe(paths.execPath);
    expect(spec.args).toEqual([paths.mcpScriptPath]);
    expect(spec.env).toEqual({
      ELECTRON_RUN_AS_NODE: '1',
      MUSEFOLD_AUTOSTART: '1',
      MUSEFOLD_APP_EXECUTABLE: paths.execPath,
    });
  });

  it('Cursor JSON：合法 JSON，含 env，且不含任何密钥形态字段', () => {
    const snippet = cursorConfigSnippet(paths);
    const parsed = JSON.parse(snippet);
    expect(parsed.mcpServers.musefold.command).toBe(paths.execPath);
    expect(parsed.mcpServers.musefold.env.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(parsed.mcpServers.musefold.env.MUSEFOLD_AUTOSTART).toBe('1');
    expect(parsed.mcpServers.musefold.env.MUSEFOLD_APP_EXECUTABLE).toBe(paths.execPath);
    expect(snippet).not.toMatch(/token|sk-|key/i);
  });

  it('Cursor deeplink：base64 config 可还原', () => {
    const link = cursorInstallDeeplink(paths);
    expect(link).toMatch(/^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?name=musefold&config=/);
    const encoded = decodeURIComponent(link.split('config=')[1]);
    const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    expect(decoded.command).toBe(paths.execPath);
  });

  it('Claude Code 命令：user 可直接粘贴执行', () => {
    const command = claudeCodeAddCommand(paths);
    expect(command).toContain('claude mcp add musefold');
    expect(command).toContain('--env "ELECTRON_RUN_AS_NODE=1"');
    expect(command).toContain('MUSEFOLD_AUTOSTART=1');
    expect(command).toContain('MUSEFOLD_APP_EXECUTABLE=');
    expect(command).toContain(`"${paths.execPath}"`);
  });

  it('Codex TOML：含超时调优与 env 表', () => {
    const toml = codexConfigSnippet(paths);
    expect(toml).toContain('[mcp_servers.musefold]');
    expect(toml).toContain('tool_timeout_sec = 300');
    expect(toml).toContain('[mcp_servers.musefold.env]');
    expect(toml).toContain('ELECTRON_RUN_AS_NODE = "1"');
    expect(toml).toContain('MUSEFOLD_AUTOSTART = "1"');
    expect(toml).toContain(`MUSEFOLD_APP_EXECUTABLE = ${JSON.stringify(paths.execPath)}`);
  });

  it('POSIX shim：shebang + NODE_PATH（serve 的原生模块解析）+ 参数透传', () => {
    const shim = cliShimPosix(paths);
    expect(shim.startsWith('#!/bin/sh')).toBe(true);
    expect(shim).toContain('ELECTRON_RUN_AS_NODE=1');
    expect(shim).toContain('MUSEFOLD_AUTOSTART=1');
    expect(shim).toContain(`MUSEFOLD_APP_EXECUTABLE="${paths.execPath}"`);
    expect(shim).toContain(`NODE_PATH="${paths.nodeModulesPath}"`);
    expect(shim).toContain('"$@"');
  });

  it('Windows shim：cmd 形态 + %* 透传', () => {
    const shim = cliShimWindows(paths);
    expect(shim).toContain('@echo off');
    expect(shim).toContain('MUSEFOLD_AUTOSTART=1');
    expect(shim).toContain(`MUSEFOLD_APP_EXECUTABLE=${paths.execPath}`);
    expect(shim).toContain('%*');
    expect(shim).toContain(paths.cliScriptPath);
  });
});
