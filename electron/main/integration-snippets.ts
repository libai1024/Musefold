// 客户端接入片段（纯函数，可单测）：给定解析好的可执行路径与内置产物路径，
// 生成 Cursor / Claude Code / ChatGPT 桌面（Codex 宿主）的配置。
//
// 关键设计：配置里**没有任何密钥**——MCP 服务器经发现链自读 automation.json；
// 运行时用 ELECTRON_RUN_AS_NODE=1 让 App 自身可执行文件充当 Node（零外部依赖）。

export interface IntegrationPaths {
  /** App（或开发时 Electron）可执行文件绝对路径 */
  execPath: string;
  /** 内置 MCP 服务器脚本绝对路径 */
  mcpScriptPath: string;
  /** 内置 CLI 脚本绝对路径 */
  cliScriptPath: string;
  /** 打包 App 的 node_modules（asar.unpacked）；CLI serve 的原生模块解析用 */
  nodeModulesPath: string | null;
}

export interface McpLaunchSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export function mcpLaunchSpec(paths: IntegrationPaths): McpLaunchSpec {
  return {
    command: paths.execPath,
    args: [paths.mcpScriptPath],
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      MUSEFOLD_AUTOSTART: '1',
      MUSEFOLD_APP_EXECUTABLE: paths.execPath,
    },
  };
}

/** Cursor：~/.cursor/mcp.json 片段 */
export function cursorConfigSnippet(paths: IntegrationPaths): string {
  const spec = mcpLaunchSpec(paths);
  return JSON.stringify(
    { mcpServers: { musefold: { command: spec.command, args: spec.args, env: spec.env } } },
    null,
    2,
  );
}

/** Cursor：官方一键安装 deeplink（config 为 base64(JSON)） */
export function cursorInstallDeeplink(paths: IntegrationPaths): string {
  const spec = mcpLaunchSpec(paths);
  const config = Buffer.from(
    JSON.stringify({ command: spec.command, args: spec.args, env: spec.env }),
    'utf8',
  ).toString('base64');
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=musefold&config=${encodeURIComponent(config)}`;
}

/** Claude Code：一条 claude mcp add 命令（shell 转义按双引号包裹处理） */
export function claudeCodeAddCommand(paths: IntegrationPaths): string {
  const spec = mcpLaunchSpec(paths);
  const quote = (value: string) => `"${value.replaceAll('"', '\\"')}"`;
  return [
    'claude mcp add musefold',
    ...Object.entries(spec.env).map(([key, value]) => `--env ${quote(`${key}=${value}`)}`),
    '--',
    quote(spec.command),
    ...spec.args.map(quote),
  ].join(' ');
}

/** ChatGPT 桌面 / Codex CLI / IDE 扩展：共享 ~/.codex/config.toml 的片段 */
export function codexConfigSnippet(paths: IntegrationPaths): string {
  const spec = mcpLaunchSpec(paths);
  return [
    '[mcp_servers.musefold]',
    `command = ${JSON.stringify(spec.command)}`,
    `args = [${spec.args.map((arg) => JSON.stringify(arg)).join(', ')}]`,
    'startup_timeout_sec = 20',
    'tool_timeout_sec = 300',
    '',
    '[mcp_servers.musefold.env]',
    ...Object.entries(spec.env).map(([key, value]) => `${key} = ${JSON.stringify(value)}`),
  ].join('\n');
}

/** CLI shim（POSIX）：装进 PATH 后终端直接 `musefold …`；serve 需要 NODE_PATH 指向打包内原生模块 */
export function cliShimPosix(paths: IntegrationPaths): string {
  const nodePathLine = paths.nodeModulesPath
    ? `export NODE_PATH="${paths.nodeModulesPath}"\n`
    : '';
  return [
    '#!/bin/sh',
    '# Musefold CLI shim —— 由 Musefold App 生成（设置 → 自动化 → 安装命令行工具）',
    'export ELECTRON_RUN_AS_NODE=1',
    'export MUSEFOLD_AUTOSTART=1',
    `export MUSEFOLD_APP_EXECUTABLE="${paths.execPath}"`,
    nodePathLine.trimEnd(),
    `exec "${paths.execPath}" "${paths.cliScriptPath}" "$@"`,
    '',
  ].filter((line) => line !== '').join('\n');
}

/** CLI shim（Windows .cmd） */
export function cliShimWindows(paths: IntegrationPaths): string {
  const nodePathLine = paths.nodeModulesPath ? `set "NODE_PATH=${paths.nodeModulesPath}"\r\n` : '';
  return (
    '@echo off\r\n' +
    'set ELECTRON_RUN_AS_NODE=1\r\n' +
    'set MUSEFOLD_AUTOSTART=1\r\n' +
    `set "MUSEFOLD_APP_EXECUTABLE=${paths.execPath}"\r\n` +
    nodePathLine +
    `"${paths.execPath}" "${paths.cliScriptPath}" %*\r\n`
  );
}
