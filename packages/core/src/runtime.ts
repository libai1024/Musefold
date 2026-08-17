// core 内部运行时接缝（V04-CORE-03，P1 过渡机制）。
//
// 「搬移不重构」：db/providers 原样搬进 core，它们对宿主的四个依赖
// （路径、同步密钥读取、日志、单价估算）在此收口为可注入的运行时。
// Electron 侧由 core-instance 直接注入既有实现（system/paths、
// security/keychain、system/logger、settings/pricing），零行为变化。
// P3 收口 shared/ 进 core 时，这里将折叠进正式的 ports（异步 SecretsPort 等）。

import type { GenerateImageRequest, GenerateImageResult, ValidationResult } from '@shared/types/providers';
import type { Logger } from './ports';

/** 与 electron/system/paths.ts 的 getPaths() 同形态。 */
export interface CorePaths {
  userData: string;
  db: string;
  backups: string;
  previews: string;
  pictures: string;
  logs: string;
}

/** Electron 宿主提供的豆包网页自动化端口；headless/CLI 宿主可以不实现。 */
export interface DoubaoWebRuntime {
  validate(): Promise<ValidationResult>;
  generateImage(req: GenerateImageRequest, signal?: AbortSignal): Promise<GenerateImageResult>;
}

export interface CoreRuntime {
  getPaths(): CorePaths;
  /**
   * 同步密钥读取（Electron safeStorage 本身是同步的）。
   * headless 实现（P4）负责在启动时预热，保持同步语义。
   */
  loadApiKey(providerId: string): string | null;
  createLogger(scope: string): Logger;
  estimateProviderCost(
    providerId: string,
    req: { n?: number },
    usageTokens?: number | null,
  ): number | null;
  doubaoWeb?: DoubaoWebRuntime;
}

let runtime: CoreRuntime | null = null;

export function configureCoreRuntime(next: CoreRuntime): void {
  runtime = next;
}

export function getCoreRuntime(): CoreRuntime {
  if (!runtime) {
    throw new Error('Musefold core runtime 未配置：宿主必须先调用 configureCoreRuntime');
  }
  return runtime;
}

// —— 以下为搬移代码的同名直用出口（保持原 import 名不变，仅换路径）——

export function getPaths(): CorePaths {
  return getCoreRuntime().getPaths();
}

export function loadApiKey(providerId: string): string | null {
  return getCoreRuntime().loadApiKey(providerId);
}

/**
 * 惰性 logger：搬移代码有模块作用域的 createLogger 调用（如 wukong-studio），
 * 与原 system/logger 语义一致——创建时安全，写日志时才解析环境；
 * runtime 未配置时退回 console（仅测试/异常场景会走到）。
 */
export function createLogger(scope: string): Logger {
  const emit =
    (level: 'debug' | 'info' | 'warn' | 'error') =>
    (...args: unknown[]) => {
      if (runtime) {
        runtime.createLogger(scope)[level](...args);
        return;
      }
      const fallback = level === 'debug' ? 'log' : level;
      console[fallback](`[core:${scope}]`, ...args);
    };
  return { debug: emit('debug'), info: emit('info'), warn: emit('warn'), error: emit('error') };
}

export function estimateProviderCost(
  providerId: string,
  req: { n?: number },
  usageTokens?: number | null,
): number | null {
  return getCoreRuntime().estimateProviderCost(providerId, req, usageTokens);
}

export function getDoubaoWebRuntime(): DoubaoWebRuntime {
  const bridge = getCoreRuntime().doubaoWeb;
  if (!bridge) {
    const error = new Error('豆包网页版仅可在 Musefold 桌面应用中使用');
    (error as { code?: string }).code = 'DESKTOP_ONLY';
    throw error;
  }
  return bridge;
}
