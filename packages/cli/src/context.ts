// 命令执行上下文：全局旗标 + 客户端连接（三态发现：App / 守护 / 无）。

import { dirname } from 'node:path';
import { discoverOrStartEndpoint, MusefoldClient, MusefoldClientError } from '@musefold/client';
import { ArgsError, parseArgs, type FlagSpec, type ParsedArgs } from './args';
import { EXIT, type CliIo } from './io';

export const GLOBAL_FLAGS: FlagSpec[] = [
  { name: 'json', takesValue: false },
  { name: 'quiet', short: 'q', takesValue: false },
  { name: 'yes', short: 'y', takesValue: false },
  { name: 'max-cost', takesValue: true },
  { name: 'endpoint', takesValue: true },
  { name: 'token', takesValue: true },
  { name: 'no-color', takesValue: false },
  { name: 'autostart', takesValue: false },
  { name: 'help', short: 'h', takesValue: false },
];

export interface CliContext {
  io: CliIo;
  args: ParsedArgs;
  json: boolean;
  yes: boolean;
  maxCostCents: number | null;
  env: NodeJS.ProcessEnv;
}

export class CliExit extends Error {
  constructor(public readonly code: number) {
    super(`exit ${code}`);
  }
}

export function parseCommandArgs(argv: string[], extraFlags: FlagSpec[] = []): ParsedArgs {
  return parseArgs(argv, [...GLOBAL_FLAGS, ...extraFlags]);
}

export async function connect(context: CliContext): Promise<MusefoldClient> {
  return (await connectDetailed(context)).client;
}

export interface DetailedConnection {
  client: MusefoldClient;
  /** 发现文件所在数据目录；显式 endpoint（无发现文件）时为 null */
  dataDir: string | null;
}

export async function connectDetailed(context: CliContext): Promise<DetailedConnection> {
  const endpoint = typeof context.args.flags.endpoint === 'string' ? context.args.flags.endpoint : undefined;
  const token = typeof context.args.flags.token === 'string' ? context.args.flags.token : undefined;
  if (endpoint && token) {
    const explicitDataDir = context.env.MUSEFOLD_DATA_DIR ?? null;
    return { client: new MusefoldClient({ endpoint, token }), dataDir: explicitDataDir };
  }

  const autostart = context.args.flags.autostart === true
    || context.env.MUSEFOLD_AUTOSTART === '1'
    || context.env.ELECTRON_RUN_AS_NODE === '1';
  const discovered = await discoverOrStartEndpoint({
    env: context.env,
    autostart,
    logger: (line) => context.io.stderr(`musefold: ${line}`),
  });
  if (!discovered) {
    const message = '无法连接 Musefold 0.5 桌面控制面。请启动 Musefold，并在“设置 > 自动化”中开启本地控制面。';
    context.io.stderr(`musefold: ${message}`);
    if (context.json) context.io.stdout(JSON.stringify({ type: 'error', code: 'NOT_CONNECTED', message }));
    throw new CliExit(EXIT.NOT_CONNECTED);
  }
  const dataDir = discovered.source === 'env' ? (context.env.MUSEFOLD_DATA_DIR ?? null) : dirname(discovered.source);
  return { client: new MusefoldClient({ endpoint: discovered.endpoint, token: discovered.token }), dataDir };
}

/**
 * 本地专属调用（V04-SECURITY §4.3）：先取一次性质询，读回 dataDir 下的
 * 质询文件内容作为同机同用户证明，再发起真实请求。
 */
export async function localCall<T = unknown>(
  connection: DetailedConnection,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  if (!connection.dataDir) {
    throw new CliExit(EXIT.GENERAL);
  }
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const challenge = await connection.client.request<{ challengeId: string; fileName: string }>(
    '/v1/local/challenge',
    { method: 'POST' },
  );
  const content = readFileSync(join(connection.dataDir, ...challenge.fileName.split('/')), 'utf8');
  return connection.client.request<T>(path, {
    method: init.method ?? 'POST',
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    headers: { 'x-musefold-local-proof': `${challenge.challengeId}:${content}` },
  });
}

/** 把客户端/参数错误统一翻译为退出码。 */
export function exitCodeForError(error: unknown): number {
  if (error instanceof CliExit) return error.code;
  if (error instanceof ArgsError) return EXIT.ARGS;
  if (error instanceof MusefoldClientError) {
    if (error.code === 'NOT_CONNECTED') return EXIT.NOT_CONNECTED;
    if (error.code === 'CONFIRMATION_DENIED' || error.code === 'CONFIRMATION_TIMEOUT') return EXIT.REFUSED;
    if (error.code === 'BUDGET_EXCEEDED') return EXIT.BUDGET;
    if (error.code.startsWith('PROVIDER')) return EXIT.PROVIDER;
    return EXIT.GENERAL;
  }
  return EXIT.GENERAL;
}
