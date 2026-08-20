// packages/desktop-contracts/src/ipc/share.ts
// share / deeplink 域：请求响应类型 + Api namespace（V13-GOV-04 自 ipc.ts 分域拆出；docs/product/15 TASK-DIF-05）。

import type { Prompt } from "../models";
import type { SharePayload } from "../share";

export interface ShareRenderCardRequest {
  promptId?: string;
  payload?: SharePayload;
  /** 测试或高级入口可直接指定 PNG 落盘位置；不传则写到 userData/shares。 */
  savePath?: string;
}

export interface ShareRenderCardResult {
  pngPath: string;
  deeplink: string;
}

export interface ShareBuildDeeplinkRequest {
  payload: SharePayload;
}

export interface ShareBuildDeeplinkResult {
  deeplink: string;
}

export interface ShareParseDeeplinkRequest {
  url: string;
}

export interface ShareParseDeeplinkResult {
  payload: SharePayload;
}

export interface ShareImportRequest {
  payload: SharePayload;
}

export interface ShareImportResult {
  prompt: Prompt;
}

export interface ShareApi {
  renderCard: (req: ShareRenderCardRequest) => Promise<ShareRenderCardResult>;
  buildDeeplink: (req: ShareBuildDeeplinkRequest) => Promise<ShareBuildDeeplinkResult>;
  parseDeeplink: (
    req: ShareParseDeeplinkRequest,
  ) => Promise<ShareParseDeeplinkResult>;
  import: (req: ShareImportRequest) => Promise<ShareImportResult>;
  consumePending: () => Promise<{ payloads: SharePayload[] }>;
  /** 订阅 OS deeplink 唤起事件，返回取消订阅函数。 */
  onIncoming: (cb: (payload: SharePayload) => void) => () => void;
}
