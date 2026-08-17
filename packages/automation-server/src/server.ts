import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import type { CoreError, CoreEvent, EventHub, Logger, MusefoldCore } from '@musefold/core';
import {
  discoveryFilePath,
  removeDiscoveryFileIfOwned,
  writeDiscoveryFile,
  type DiscoveryDocument,
} from './discovery';
import { bearerToken, generateToken, tokenEquals } from './token';

export const AUTOMATION_API_VERSION = 'v1';
export const DEFAULT_REQUEST_BODY_LIMIT = 2 * 1024 * 1024;
export const DEFAULT_UPLOAD_BODY_LIMIT = 25 * 1024 * 1024;
export const DEFAULT_RATE_LIMIT = 60;
export const DEFAULT_GENERATION_RATE_LIMIT = 10;
export const DEFAULT_JSON_DEPTH_LIMIT = 32;

export interface AuditRecord {
  at: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  caller?: string;
  errorCode?: string;
}

export interface AutomationRouteContext {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  body: unknown;
  /** 路径参数（路由键中的 :name 段），如 'GET /v1/prompts/:id' → { id } */
  params: Record<string, string>;
  json(value: unknown, status?: number): void;
}

export type AutomationRouteHandler = (context: AutomationRouteContext) => unknown | Promise<unknown>;

export interface AutomationServerOptions {
  core: Pick<MusefoldCore, 'version' | 'status'>;
  events?: Pick<EventHub, 'subscribe'>;
  dataDir: string;
  owner: DiscoveryDocument['owner'];
  appVersion: string;
  host?: string;
  port?: number;
  token?: string;
  logger?: Logger;
  clock?: () => Date;
  routes?: Record<string, AutomationRouteHandler>;
  onAudit?: (record: AuditRecord) => void | Promise<void>;
  rateLimit?: number;
  generationRateLimit?: number;
  requestBodyLimit?: number;
  uploadBodyLimit?: number;
  jsonDepthLimit?: number;
  /** 仅桌面宿主可提供的可选能力；无声明时保持 headless 契约。 */
  capabilities?: { setup?: boolean };
}

export interface AutomationServerInfo {
  host: string;
  port: number;
  token: string;
  discoveryPath: string;
}

export interface AutomationServer {
  readonly info: AutomationServerInfo | null;
  readonly listening: boolean;
  start(): Promise<AutomationServerInfo>;
  stop(): Promise<void>;
  rotateToken(): string;
}

export class AutomationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 500,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AutomationError';
  }
}

type AnyCoreError = Pick<CoreError, 'code' | 'message' | 'details'>;
function isCoreError(error: unknown): error is AnyCoreError {
  return Boolean(error && typeof error === 'object' && 'code' in error && 'message' in error && 'details' in error);
}

function statusForError(error: AutomationError | AnyCoreError): number {
  if (error instanceof AutomationError) return error.status;
  switch (error.code) {
    case 'NOT_FOUND': return 404;
    case 'INVALID_INPUT': case 'VALIDATION_ERROR': return 400;
    case 'CONFLICT': case 'BUSY': return 409;
    case 'POLICY_DENIED': return 403;
    case 'UNPROCESSABLE_ENTITY': return 422;
    default: return 500;
  }
}

function errorEnvelope(error: unknown): { error: { code: string; message: string; details: Record<string, unknown> } } {
  if (error instanceof AutomationError) return { error: { code: error.code, message: error.message, details: error.details } };
  if (isCoreError(error)) return { error: { code: error.code, message: error.message, details: error.details } };
  return { error: { code: 'INTERNAL_ERROR', message: '控制面发生内部错误', details: {} } };
}

function writeJson(response: ServerResponse, value: unknown, status = 200): void {
  if (response.headersSent) return;
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

function jsonDepth(value: unknown, depth = 0): number {
  if (value === null || typeof value !== 'object') return depth;
  const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  return children.reduce((maximum, child) => Math.max(maximum, jsonDepth(child, depth + 1)), depth);
}

function readBody(request: IncomingMessage, maxBytes: number, maxJsonDepth: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const contentLength = Number(request.headers['content-length'] ?? 0);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      reject(new AutomationError('REQUEST_TOO_LARGE', '请求体超过大小限制', 413, { maxBytes }));
      request.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const fail = (error: unknown) => { if (!settled) { settled = true; reject(error); request.resume(); } };
    request.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maxBytes) fail(new AutomationError('REQUEST_TOO_LARGE', '请求体超过大小限制', 413, { maxBytes }));
      else chunks.push(buffer);
    });
    request.on('error', fail);
    request.on('end', () => {
      if (settled) return;
      settled = true;
      if (bytes === 0) return resolve(undefined);
      const content = Buffer.concat(chunks);
      const contentType = String(request.headers['content-type'] ?? '').toLowerCase();
      if (!contentType.includes('application/json') && !contentType.includes('+json')) return resolve(content);
      try {
        const parsed: unknown = JSON.parse(content.toString('utf8'));
        if (jsonDepth(parsed) > maxJsonDepth) return reject(new AutomationError('JSON_TOO_DEEP', 'JSON 嵌套层级超过限制', 400, { maxDepth: maxJsonDepth }));
        resolve(parsed);
      }
      catch { reject(new AutomationError('INVALID_JSON', '请求体不是有效 JSON', 400)); }
    });
  });
}

/** 精确匹配优先；随后按 :param 段模式匹配（段数一致、非参数段全等）。 */
function matchRoute(
  routes: Record<string, AutomationRouteHandler>,
  method: string,
  path: string,
): { route: AutomationRouteHandler; params: Record<string, string> } | null {
  const exact = routes[`${method} ${path}`] ?? routes[path];
  if (exact) return { route: exact, params: {} };

  const pathSegments = path.split('/').filter(Boolean);
  for (const [key, route] of Object.entries(routes)) {
    const spaceAt = key.indexOf(' ');
    if (spaceAt < 0) continue;
    if (key.slice(0, spaceAt) !== method) continue;
    const patternSegments = key.slice(spaceAt + 1).split('/').filter(Boolean);
    if (patternSegments.length !== pathSegments.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < patternSegments.length; index += 1) {
      const pattern = patternSegments[index];
      if (pattern.startsWith(':')) params[pattern.slice(1)] = decodeURIComponent(pathSegments[index]);
      else if (pattern !== pathSegments[index]) { matched = false; break; }
    }
    if (matched) return { route, params };
  }
  return null;
}

class SlidingWindowLimiter {
  private readonly buckets = new Map<string, number[]>();
  constructor(private readonly max: number, private readonly windowMs = 60_000, private readonly clock = () => Date.now()) {}
  allow(key: string): boolean {
    const cutoff = this.clock() - this.windowMs;
    const current = (this.buckets.get(key) ?? []).filter((at) => at > cutoff);
    if (current.length >= this.max) { this.buckets.set(key, current); return false; }
    current.push(this.clock()); this.buckets.set(key, current); return true;
  }
  clear(): void { this.buckets.clear(); }
}

export function createAutomationServer(options: AutomationServerOptions): AutomationServer {
  const host = options.host ?? '127.0.0.1';
  if (host !== '127.0.0.1' && host !== '::1') throw new AutomationError('LOOPBACK_ONLY', '控制面只能绑定 loopback 地址', 400, { host });
  const clock = options.clock ?? (() => new Date());
  const logger = options.logger ?? { debug() {}, info() {}, warn() {}, error() {} };
  const generalLimiter = new SlidingWindowLimiter(options.rateLimit ?? DEFAULT_RATE_LIMIT);
  const generationLimiter = new SlidingWindowLimiter(options.generationRateLimit ?? DEFAULT_GENERATION_RATE_LIMIT);
  const routes = options.routes ?? {};
  const clients = new Set<ServerResponse>();
  let token = options.token ?? generateToken();
  let server: Server | null = null;
  let currentInfo: AutomationServerInfo | null = null;
  let stopping: Promise<void> | null = null;
  let startedAt: string | null = null;

  const broadcast = (type: string, payload: unknown) => {
    const message = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of [...clients]) {
      if (client.writableEnded || client.destroyed) { clients.delete(client); continue; }
      try { client.write(message); } catch { clients.delete(client); }
    }
  };

  const audit = async (record: AuditRecord) => {
    try { await options.onAudit?.(record); } catch (error) { logger.warn('automation audit failed', error); }
  };
  const health = () => {
    let snapshot: ReturnType<typeof options.core.status.snapshot> | undefined;
    try { snapshot = options.core.status.snapshot(); } catch (error) { logger.warn('health snapshot unavailable', error); }
    return {
      connected: true, owner: options.owner, appVersion: options.appVersion,
      apiVersion: AUTOMATION_API_VERSION, coreVersion: options.core.version,
      capabilities: {
        generation: true,
        schemes: true,
        skills: true,
        setup: options.capabilities?.setup === true,
      },
      ...(snapshot ? { data: snapshot } : {}),
    };
  };
  const document = (port: number, startedAt: string): DiscoveryDocument => ({
    version: 1, apiVersion: AUTOMATION_API_VERSION, pid: process.pid, port, token,
    owner: options.owner, appVersion: options.appVersion, startedAt,
  });
  const handler = async (request: IncomingMessage, response: ServerResponse) => {
    const started = Date.now();
    const method = request.method ?? 'GET';
    const requestUrl = new URL(request.url ?? '/', `http://${host}`);
    const path = requestUrl.pathname;
    let status = 200;
    let errorCode: string | undefined;
    try {
      if (request.headers.origin !== undefined) throw new AutomationError('ORIGIN_NOT_ALLOWED', '控制面不接受带 Origin 的浏览器请求', 403);
      const provided = bearerToken(typeof request.headers.authorization === 'string' ? request.headers.authorization : undefined);
      if (!provided || !tokenEquals(token, provided)) throw new AutomationError('UNAUTHORIZED', '缺少或无效的控制面 token', 401);
      const source = request.socket.remoteAddress ?? 'unknown';
      // 生图类限流只作用于真正花钱的提交动作；估算/轮询/取消是只读或幂等操作，走全局限流即可
      const isSpendSubmit = method === 'POST' && path === `/${AUTOMATION_API_VERSION}/generations`;
      if (!generalLimiter.allow(source) || (isSpendSubmit && !generationLimiter.allow(source))) throw new AutomationError('RATE_LIMITED', '请求过于频繁，请稍后重试', 429);
      if (method === 'GET' && path === `/${AUTOMATION_API_VERSION}/health`) { writeJson(response, health()); return; }
      if (method === 'GET' && path === `/${AUTOMATION_API_VERSION}/events`) {
        response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-content-type-options': 'nosniff' });
        response.write(': connected\n\n'); clients.add(response);
        const jobId = requestUrl.searchParams.get('jobId');
        const eventListener = options.events?.subscribe((event) => {
          if (jobId && !(typeof event.payload === 'object' && event.payload && 'jobId' in event.payload && event.payload.jobId === jobId)) return;
          try { response.write(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`); } catch { clients.delete(response); }
        });
        const heartbeat = setInterval(() => { if (!response.destroyed) response.write(': heartbeat\n\n'); }, 15_000);
        const cleanup = () => { clearInterval(heartbeat); clients.delete(response); eventListener?.(); };
        request.on('close', cleanup); response.on('close', cleanup); return;
      }
      const matched = matchRoute(routes, method, path);
      if (!matched) throw new AutomationError('NOT_FOUND', '控制面端点不存在', 404, { method, path });
      const { route, params } = matched;
      const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(
        request,
        path.startsWith(`/${AUTOMATION_API_VERSION}/uploads`) ? (options.uploadBodyLimit ?? DEFAULT_UPLOAD_BODY_LIMIT) : (options.requestBodyLimit ?? DEFAULT_REQUEST_BODY_LIMIT),
        options.jsonDepthLimit ?? DEFAULT_JSON_DEPTH_LIMIT,
      );
      const result = await route({ request, response, url: requestUrl, body, params, json: (value, responseStatus = 200) => writeJson(response, value, responseStatus) });
      if (!response.writableEnded && result !== undefined) writeJson(response, result);
    } catch (error) {
      const envelope = errorEnvelope(error);
      status = error instanceof AutomationError ? error.status : isCoreError(error) ? statusForError(error) : 500;
      errorCode = envelope.error.code; writeJson(response, envelope, status);
    } finally {
      void audit({ at: clock().toISOString(), method, path, status: response.statusCode || status, durationMs: Date.now() - started, errorCode });
    }
  };

  return {
    get info() { return currentInfo; }, get listening() { return server?.listening ?? false; },
    async start() {
      if (currentInfo) return currentInfo;
      stopping = null;
      server = createServer((request, response) => { void handler(request, response); });
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => { server?.off('listening', onListening); reject(error); };
        const onListening = () => { server?.off('error', onError); resolve(); };
        server!.once('error', onError); server!.once('listening', onListening); server!.listen(options.port ?? 0, host);
      });
      const address = server.address(); const actualPort = typeof address === 'object' && address ? address.port : options.port ?? 0;
      startedAt = clock().toISOString();
      currentInfo = { host, port: actualPort, token, discoveryPath: discoveryFilePath(options.dataDir) };
      try { writeDiscoveryFile(options.dataDir, document(actualPort, startedAt)); }
      catch (error) { await new Promise<void>((resolve) => server!.close(() => resolve())); server = null; currentInfo = null; startedAt = null; throw error; }
      logger.info('automation server listening', { host, port: actualPort, owner: options.owner }); return currentInfo;
    },
    async stop() {
      if (stopping) return stopping;
      stopping = (async () => {
        for (const client of [...clients]) { try { client.end(); } catch {} } clients.clear();
        generalLimiter.clear(); generationLimiter.clear(); const info = currentInfo; currentInfo = null;
        if (info) removeDiscoveryFileIfOwned(options.dataDir, { pid: process.pid, port: info.port, token: info.token });
        if (server) await new Promise<void>((resolve) => server!.close(() => resolve())); server = null; startedAt = null;
      })(); return stopping;
    },
    rotateToken() {
      token = generateToken();
      if (currentInfo) { currentInfo = { ...currentInfo, token }; writeDiscoveryFile(options.dataDir, document(currentInfo.port, startedAt ?? clock().toISOString())); }
      broadcast('token.rotated', { apiVersion: AUTOMATION_API_VERSION });
      return token;
    },
  };
}
