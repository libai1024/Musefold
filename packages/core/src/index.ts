// @musefold/core 公共出口。
// 消费方式（v0.4）：App/守护经打包器别名直读 TS 源（electron.vite / vitest / tsconfig
// paths 均映射 `@musefold/core` → packages/core/src），不作为外部化依赖进入
// electron-builder 的 node_modules 打包面；独立构建发布是 P4（V04-PKG-01）的事。

export type {
  Clock,
  CoreEvent,
  CoreOptions,
  EventSink,
  Logger,
  PathsPort,
  SecretsPort,
} from './ports';
export { createEventHub, type CoreEventListener, type EventHub } from './events';
export { CORE_VERSION, createMusefoldCore, type MusefoldCore, type GenerationService } from './core';
export { CoreError } from './services/errors';
export type { LibraryService } from './services/library';
export type { HistoryService, HistoryListQuery, HistoryDetail } from './services/history';
export type { ProviderService } from './services/providers';
export type {
  SchemeService,
  SchemeDetail,
  CompileSchemeRequest,
  CompileSchemeResult,
} from './services/schemes';
export type { StatusService, StatusSnapshot } from './services/status';
