// musefold CLI 入口：runCli 纯函数（返回退出码），bin 壳只做 process.exit 桥接。

import { ArgsError, type FlagSpec } from './args';
import { COMMANDS } from './commands';
import { commandGenerate } from './generate';
import { exitCodeForError, parseCommandArgs, type CliContext } from './context';
import { EXIT, printError, type CliIo } from './io';

const COMMAND_FLAGS: Record<string, FlagSpec[]> = {
  status: [],
  account: [],
  prompt: [
    { name: 'query', takesValue: true },
    { name: 'limit', takesValue: true },
    { name: 'source', takesValue: true },
    { name: 'title', takesValue: true },
    { name: 'body', takesValue: true },
    { name: 'body-file', takesValue: true },
    { name: 'note', takesValue: true },
    { name: 'stdin', takesValue: false },
    { name: 'force', takesValue: false },
    { name: 'tag', takesValue: true, repeatable: true },
  ],
  history: [
    { name: 'limit', takesValue: true },
    { name: 'status', takesValue: true },
    { name: 'provider', takesValue: true },
  ],
  scheme: [
    { name: 'input', takesValue: true, repeatable: true },
    { name: 'brief', takesValue: true },
    { name: 'ratio', takesValue: true },
    { name: 'n', short: 'n', takesValue: true },
    { name: 'priority', takesValue: true },
    { name: 'no-wait', takesValue: false },
  ],
  skill: [
    { name: 'prompt', short: 'p', takesValue: true },
    { name: 'ratio', takesValue: true },
    { name: 'n', short: 'n', takesValue: true },
    { name: 'no-wait', takesValue: false },
  ],
  provider: [
    { name: 'name', takesValue: true },
    { name: 'type', takesValue: true },
    { name: 'base-url', takesValue: true },
    { name: 'model', takesValue: true },
    { name: 'use', takesValue: false },
    { name: 'stdin', takesValue: false },
    { name: 'from-env', takesValue: true },
    { name: 'force', takesValue: false },
  ],
  backup: [
    { name: 'force', takesValue: false },
  ],
  export: [
    { name: 'out', short: 'o', takesValue: true },
    { name: 'mode', takesValue: true },
    { name: 'include-history', takesValue: false },
  ],
  import: [
    { name: 'strategy', takesValue: true },
    { name: 'dry-run', takesValue: false },
  ],
  generate: [
    { name: 'prompt', short: 'p', takesValue: true },
    { name: 'stdin-prompt', takesValue: false },
    { name: 'provider', takesValue: true },
    { name: 'model', takesValue: true },
    { name: 'ratio', takesValue: true },
    { name: 'n', short: 'n', takesValue: true },
    { name: 'quality', takesValue: true },
    { name: 'background', takesValue: true },
    { name: 'negative', takesValue: true },
    { name: 'ref', takesValue: true, repeatable: true },
    { name: 'ref-history', takesValue: true, repeatable: true },
    { name: 'out', short: 'o', takesValue: true },
    { name: 'no-wait', takesValue: false },
  ],
  cancel: [],
};

const USAGE = [
  'musefold —— Musefold 的终端入口（本地控制面客户端）',
  '',
  '用法：musefold <命令> [参数]',
  '',
  '命令：',
  '  status                     连接诊断：所有者/版本/数据计数',
  '  generate                   生图（-p / --stdin-prompt，--ref 垫图，-o 输出目录）',
  '  cancel <jobId>             取消进行中的生成',
  '  prompt list|search|get|add|rm 提示词库（rm 需 --force，进回收站）',
  '  history list|show          生成历史与成本',
  '  scheme list|show|compile|run 设计方案（仅正式版）',
  '  skill run <github-url>     运行 GitHub 视觉 Skill（不执行仓库脚本）',
  '  account status|login|register  查看账号接入状态或打开 Musefold 原生登录页',
  '  provider list|models|setup|add|set-key|rm|validate|use  Provider 管理（setup 打开原生安全表单）',
  '  backup now|list|restore    备份（restore 需 --force）',
  '  export / import            库导出导入（本地通道）',
  '  serve [--data-dir]         headless 本地 Provider 守护（不读取桌面账号，与 App 互斥）',
  '',
  '全局参数：--json（机器可读输出）、-y 跳过确认、--max-cost <分>、--endpoint/--token、--autostart、-q',
  '连接：安装版 CLI 会自动拉起 Musefold App；桌面账号仅由 App 的自动化控制面提供。',
].join('\n');

export async function runCli(argv: string[], io: CliIo, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    io.stdout(USAGE);
    return command ? EXIT.OK : EXIT.ARGS;
  }
  if (command === 'serve') {
    return runServe(argv.slice(1), io);
  }
  const runner = command === 'generate' ? commandGenerate : COMMANDS[command];
  if (!runner) {
    io.stderr(`musefold: 未知命令「${command}」。运行 musefold help 查看用法。`);
    return EXIT.ARGS;
  }
  let context: CliContext;
  try {
    const args = parseCommandArgs(rest, COMMAND_FLAGS[command] ?? []);
    context = {
      io,
      args,
      json: args.flags.json === true,
      yes: args.flags.yes === true,
      maxCostCents: typeof args.flags['max-cost'] === 'string' ? Number(args.flags['max-cost']) : null,
      env,
    };
  } catch (error) {
    if (error instanceof ArgsError) {
      printError(io, argv.includes('--json'), 'INVALID_ARGS', error.message);
      return EXIT.ARGS;
    }
    throw error;
  }
  try {
    return await runner(context, context.args.positional);
  } catch (error) {
    const code = exitCodeForError(error);
    const message = error instanceof Error ? error.message : String(error);
    if (code !== EXIT.NOT_CONNECTED) {
      // NOT_CONNECTED 的引导语已在 connect() 输出
      printError(io, context.json, error instanceof Error && 'code' in error ? String((error as { code: unknown }).code) : 'ERROR', message);
    }
    return code;
  }
}

async function runServe(argv: string[], io: CliIo): Promise<number> {
  const args = parseCommandArgs(argv, [
    { name: 'data-dir', takesValue: true },
    { name: 'port', takesValue: true },
    { name: 'headless', takesValue: false },
  ]);
  try {
    // 动态导入：serve 运行时携带 core（better-sqlite3 原生依赖），
    // 纯客户端命令不为它付出冷启动代价。
    const { startHeadlessServe } = await import('./serve-runtime');
    const handle = await startHeadlessServe({
      dataDir: typeof args.flags['data-dir'] === 'string' ? String(args.flags['data-dir']) : undefined,
      port: typeof args.flags.port === 'string' ? Number(args.flags.port) : undefined,
      log: (line) => io.stderr(line),
    });
    io.stderr(`musefold: 守护运行中（Ctrl-C 退出）；发现文件已写入 ${handle.dataDir}`);
    await new Promise<void>((resolve) => {
      const shutdown = () => {
        io.stderr('musefold: 正在停止守护…');
        void handle.stop().then(() => resolve());
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    });
    return EXIT.OK;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'OWNER_LOCK_HELD') {
      io.stderr(`musefold: ${error instanceof Error ? error.message : String(error)}；接管前请先退出它。`);
      return EXIT.NOT_CONNECTED;
    }
    io.stderr(`musefold: 守护启动失败：${error instanceof Error ? error.message : String(error)}`);
    return EXIT.GENERAL;
  }
}

export { EXIT } from './io';
