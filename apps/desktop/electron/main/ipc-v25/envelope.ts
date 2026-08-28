// v2.5 单通道桥的公共信封与方法定义(各域方法表共用)。

import type { z } from 'zod';

export type BridgeEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string };

export interface MethodDef {
  input: z.ZodType;
  handle(input: unknown): Promise<unknown>;
}

/** 业务错误:经信封序列化为 { ok:false, code, message },不走异常通道。 */
export class BridgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BridgeError';
  }
}
