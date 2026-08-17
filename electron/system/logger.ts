// electron/system/logger.ts
// 主进程分级日志 —— 控制台 + 轮转文件（userData/logs/main.log）
// 安全约束：绝不写入 API Key。所有输出经过 redact() 脱敏（sk-*, Bearer, Authorization）。
// 详见 docs/10 §3.3、docs/11 §10

import { appendFile, mkdir, stat, rename, readFile } from 'fs/promises';
import { join } from 'path';
import { getPaths } from './paths';
import { installConsoleOutputGuards, writeConsoleLine } from './console-output';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** 生产环境默认 info，开发环境 debug */
const MIN_LEVEL: LogLevel = process.env.NODE_ENV === 'development' ? 'debug' : 'info';

const MAX_BYTES = 2 * 1024 * 1024; // 单文件 2MB 后轮转
const LOG_FILE = 'main.log';
const LOG_FILE_OLD = 'main.1.log';

let writeChain: Promise<void> = Promise.resolve();

// Electron can outlive the terminal or launcher that owns stdout/stderr. A
// closed pipe must only disable console mirroring; file logging stays active.
installConsoleOutputGuards();

/** 脱敏：抹掉任何疑似密钥/凭证的片段，避免落盘泄漏 */
export function redact(input: unknown): string {
  let s = typeof input === 'string' ? input : safeStringify(input);
  // sk-xxxx 形态密钥（保留前后各少量字符便于对照，但主体打码）
  s = s.replace(/\b(sk-[A-Za-z0-9_-]{2})[A-Za-z0-9_-]{4,}\b/g, '$1***');
  // Bearer <token>
  s = s.replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1***');
  // Authorization / x-api-key: <value>
  s = s.replace(/((?:authorization|x-api-key|api[_-]?key)\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1***');
  return s;
}

function safeStringify(v: unknown): string {
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

async function rotateIfNeeded(file: string): Promise<void> {
  try {
    const st = await stat(file);
    if (st.size >= MAX_BYTES) {
      const dir = getPaths().logs;
      await rename(file, join(dir, LOG_FILE_OLD)).catch(() => {});
    }
  } catch {
    /* 文件不存在，忽略 */
  }
}

function write(level: LogLevel, scope: string, args: unknown[]): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN_LEVEL]) return;

  const ts = new Date().toISOString();
  const body = args.map((a) => redact(a)).join(' ');
  const line = `${ts} [${level.toUpperCase()}] [${scope}] ${body}`;

  // 控制台（已脱敏）
  writeConsoleLine(level === 'debug' || level === 'info' ? 'log' : level, line);

  // 文件（串行 append，避免交错；失败不影响主流程）
  writeChain = writeChain
    .then(async () => {
      const dir = getPaths().logs;
      await mkdir(dir, { recursive: true });
      const file = join(dir, LOG_FILE);
      await rotateIfNeeded(file);
      await appendFile(file, line + '\n', 'utf8');
    })
    .catch(() => {
      /* 落盘失败静默：日志不应打断业务 */
    });
}

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  child: (scope: string) => Logger;
}

export function createLogger(scope: string): Logger {
  return {
    debug: (...a) => write('debug', scope, a),
    info: (...a) => write('info', scope, a),
    warn: (...a) => write('warn', scope, a),
    error: (...a) => write('error', scope, a),
    child: (sub) => createLogger(`${scope}:${sub}`),
  };
}

/** 读取日志文件尾部（供 UI/IPC 展示，行数上限） */
export async function tailLog(maxLines = 400): Promise<string> {
  try {
    const file = join(getPaths().logs, LOG_FILE);
    const content = await readFile(file, 'utf8');
    const lines = content.split('\n');
    return lines.slice(-maxLines).join('\n');
  } catch {
    return '';
  }
}

/** 日志目录路径（供「打开日志文件夹」） */
export function logDir(): string {
  return getPaths().logs;
}

/** 顶层默认 logger */
export const log = createLogger('app');
