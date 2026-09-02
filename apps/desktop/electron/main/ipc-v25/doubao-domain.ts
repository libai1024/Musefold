// v2.5 豆包网页登录域桥:冻结面(electron/doubao-web/browser-service)的 typed thin adapter。
// 只适配保留函数 start/refresh/logout/getStatus(openDoubaoWebLogin 语义被 start 覆盖:
// 冻结实现里 open 就是 start + {opened:true},QR 经 data URL 交渲染层展示,不弹窗)。
// 出参统一过 canonical doubaoAccountStatusSchema(无路径/无凭据/无分区名);
// 冻结面 codedError 的稳定 code + 人话 message 透传为 BridgeError,
// 未知异常原样上抛,由 gateway-bridge 统一脱敏为 INTERNAL_ERROR。

import { type DoubaoAccountStatus, doubaoAccountStatusSchema } from '@musefold/contracts';
import { z } from 'zod';
import {
  getDoubaoWebAccountStatus,
  logoutDoubaoWeb,
  refreshDoubaoWebLogin,
  startDoubaoWebLogin,
} from '../../doubao-web/browser-service';
import { BridgeError, type MethodDef } from './envelope';

/** 冻结面 codedError 使用的稳定错误码(browser-service 内静态文案,无路径/凭据)。 */
const FROZEN_DOUHAO_ERROR_CODES = new Set([
  'AUTH',
  'WEB_VERIFICATION_REQUIRED',
  'WEB_PAGE_CHANGED',
  'CANCELLED',
]);

const noInput = z.undefined().or(z.object({}).strict());

type FrozenStatusFn = () => Promise<unknown>;

function toCanonicalStatus(snapshot: unknown): DoubaoAccountStatus {
  const parsed = doubaoAccountStatusSchema.safeParse(snapshot);
  if (!parsed.success) {
    throw new BridgeError('INTERNAL_ERROR', '豆包登录状态读取失败,请重试');
  }
  return parsed.data;
}

async function invokeFrozen(fn: FrozenStatusFn): Promise<DoubaoAccountStatus> {
  try {
    return toCanonicalStatus(await fn());
  } catch (error) {
    if (error instanceof BridgeError) throw error;
    const code = (error as { code?: unknown } | null)?.code;
    if (typeof code === 'string' && FROZEN_DOUHAO_ERROR_CODES.has(code)) {
      throw new BridgeError(code, error instanceof Error ? error.message : '豆包登录失败,请重试');
    }
    throw error;
  }
}

export function buildDoubaoDomainMethods(): Record<string, MethodDef> {
  return {
    'doubao.getStatus': {
      input: noInput,
      handle: () => invokeFrozen(getDoubaoWebAccountStatus),
    },
    'doubao.startLogin': {
      input: noInput,
      handle: () => invokeFrozen(startDoubaoWebLogin),
    },
    'doubao.refreshLogin': {
      input: noInput,
      handle: () => invokeFrozen(refreshDoubaoWebLogin),
    },
    'doubao.logout': {
      input: noInput,
      handle: () => invokeFrozen(logoutDoubaoWeb),
    },
  };
}
