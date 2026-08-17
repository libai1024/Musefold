// @musefold/core 端口定义（V04-ARCHITECTURE §4.2）。
//
// 端口是 core 对宿主环境的全部依赖面：Electron 主进程与 headless 守护
// 各自提供实现，core 本身禁止 import 'electron'（安全红线 C1 的抽象化）。

/**
 * 密钥端口（红线 C1）：明文 Key 只在实现内部短暂出现，core 不缓存。
 * Electron 实现 = safeStorage + electron-store（格式不变，双端可互读）；
 * headless 实现见 V04-SECURITY §4.2（keychain / env / 加密文件三级降级）。
 */
export interface SecretsPort {
  getProviderKey(providerId: string): Promise<string | null>;
  setProviderKey(providerId: string, key: string): Promise<void>;
  deleteProviderKey(providerId: string): Promise<void>;
  getAiConnectionKey(connectionId: string): Promise<string | null>;
  setAiConnectionKey(connectionId: string, key: string): Promise<void>;
  deleteAiConnectionKey(connectionId: string): Promise<void>;
}

/**
 * 路径端口：今天 `getPaths()` 的升级。字段为惰性求值的绝对路径，
 * Electron 与 headless 必须解析到同一份数据（V04-ARCHITECTURE §4.2）。
 */
export interface PathsPort {
  /** userData 等价物：三个 SQLite 库、来源快照、备份、日志的根 */
  readonly dataDir: string;
  /** 生成产物输出目录（~/Pictures/Musefold/... 或 E2E 隔离目录） */
  readonly picturesDir: string;
  /** 日志目录 */
  readonly logsDir: string;
}

/**
 * 统一事件信封：进度 / 方案事件 / Skill 事件走同一形态，
 * 与控制面 SSE 的 `event:` + `data:` 一一对应（V04-ARCHITECTURE §5.3）。
 */
export interface CoreEvent {
  /** 事件名，点分层级，如 `generation.progress`、`scheme.run.step` */
  type: string;
  payload: unknown;
}

/** 事件出口（core → 宿主）：替代 ipcRenderer 推送的抽象。 */
export interface EventSink {
  emit(event: CoreEvent): void;
}

/** 日志端口：与主进程 logger 结构兼容（实现自带脱敏责任）。 */
export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/** 时钟端口：测试注入用。 */
export interface Clock {
  now(): number;
}

export interface CoreOptions {
  paths: PathsPort;
  secrets: SecretsPort;
  events: EventSink;
  logger: Logger;
  clock?: Clock;
}
