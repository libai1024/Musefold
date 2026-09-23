import { z } from 'zod';
import {
  accountIssuerSchema,
  createGenerationInputSchema,
  entityIdSchema,
  executionBindingSchema,
  generationExecutionReceiptSchema,
  generationIdempotencyKeySchema,
  generationReferenceImageSchema,
} from '@musefold/contracts';
import { automationPayerBindingSchema } from './automation-spend';
import { MAX_REFERENCE_IMAGES } from './providers';

const localId = z.string().min(1).max(200);
const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const hash = z.string().regex(/^[a-f0-9]{64}$/);

/**
 * 云端参考图在登记时的冻结形态:服务端定位 id/url + 主进程实际上传字节的 sha256 摘要。
 * 摘要是 LocalImageReference 字节身份的云端对位——重放或派发核对时无需再次持有字节。
 */
export const managedReferenceImageSchema = generationReferenceImageSchema
  .extend({ digest: hash })
  .strict();

/** G transport snapshot. Model is a frozen intent, not permission to use that model. */
export const managedGenerationInputSchema = z
  .object({
    negative: createGenerationInputSchema.shape.negative,
    size: createGenerationInputSchema.shape.size,
    aspectRatio: createGenerationInputSchema.shape.aspectRatio,
    quality: createGenerationInputSchema.shape.quality,
    count: createGenerationInputSchema.shape.count,
    model: createGenerationInputSchema.shape.model,
    prompt: z.string().trim().min(1).max(8_000),
    providerId: z.literal('cloud-default').default('cloud-default'),
    runKind: z.literal('free_generation').default('free_generation'),
    referenceImages: z.array(managedReferenceImageSchema).max(MAX_REFERENCE_IMAGES).default([]),
    promptReferenceSelections: z.array(z.never()).max(0).default([]),
  })
  .strict();

/** Captured by the trusted host, not supplied by a renderer as proof of authorization. */
export const managedGenerationContextSchema = z
  .object({
    apiIssuer: accountIssuerSchema,
    principalId: entityIdSchema,
    authEpoch: z.string().uuid(),
  })
  .strict();

export const registerManagedGenerationSchema = z
  .object({
    callerKey: localId,
    caller: localId,
    executionId: localId,
    binding: executionBindingSchema,
    authEpoch: z.string().uuid(),
    request: managedGenerationInputSchema,
    estimatedPoints: z.number().finite().nonnegative().nullable(),
    declaredBudgetPoints: z.number().finite().nonnegative().optional(),
    retryOfRequestId: localId.optional(),
    consent: z.literal('interactive').optional(),
    /** Original local automation intent; replay must not depend on mutable default providers. */
    automationInputHash: hash.optional(),
    now: time,
  })
  .strict();

/** A local unsent cancellation has no cloud run; retrying it needs a fresh ordinary create. */
export const managedGenerationRetrySchema = z
  .object({
    requestId: localId,
    remoteRunId: entityIdSchema.nullable(),
  })
  .strict();

/** Independent of result cleanup and of mutable local connection/account IDs. No bearer token. */
export const managedGenerationRecordSchema = z
  .object({
    requestId: localId,
    callId: localId.nullable(),
    localGenerationId: localId.nullable(),
    namespace: z.string().uuid(),
    remoteKey: generationIdempotencyKeySchema,
    callerKey: localId,
    binding: executionBindingSchema,
    authEpoch: z.string().uuid(),
    runtimeEpoch: z.string().uuid(),
    frozenRequest: managedGenerationInputSchema,
    retryOf: managedGenerationRetrySchema.nullable().default(null),
    inputHash: hash,
    automationInputHash: hash.optional(),
    /** unclaimed is not a restart permit: only the creating live coordinator can claim once. */
    submissionState: z.enum(['unclaimed', 'query_only']),
    receipt: generationExecutionReceiptSchema.nullable(),
    /** Durable user intent precedes remote cancellation; neither timestamp implies zero cost. */
    cancelRequestedAt: time.nullable().default(null),
    cancelAcknowledgedAt: time.nullable().default(null),
    createdAt: time,
    updatedAt: time,
  })
  .strict();

export type ManagedGenerationContext = z.infer<typeof managedGenerationContextSchema>;
export type RegisterManagedGeneration = z.infer<typeof registerManagedGenerationSchema>;
export type ManagedGenerationRecord = z.infer<typeof managedGenerationRecordSchema>;
export type ManagedReferenceImage = z.infer<typeof managedReferenceImageSchema>;

// ---- R/S(run_scheme / run_github_skill)托管云运行词汇 ----
// 一个 run 级 spend request(单次预留、单次请求级确认、maxImageCalls=n)下,
// 每张原图是自己的子托管生成:一个 originalJobId 恰好对应一个 callId / 本地生成行 / remoteKey。

/** 子请求与 G 同形,但张数固定为 1:每个 originalJobId 一次独立云发送。 */
export const managedRunChildInputSchema = managedGenerationInputSchema
  .extend({ count: z.literal(1) })
  .strict();

/** 注册时冻结的运行级输入;每张图的提示词在子领取(claim)时各自冻结。 */
export const managedRunRegistrationSchema = z
  .object({
    runKind: z.enum(['run_scheme', 'run_github_skill']),
    originalJobIds: z
      .array(localId)
      .min(1)
      .max(4)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: 'Original job ids must be unique within one run',
      }),
    /** 路由入口输入(params+body),与本地 BYOK 的 spend 幂等哈希语义对齐。 */
    input: z.record(z.string(), z.json()),
    /** 冻结的运行快照(body/params/jobIds/runId/source);重放时逐字段一致。 */
    frozenRun: z.record(z.string(), z.json()),
    /** S 运行可随行的 BYOK 文本绑定;托管文本(账号)仍被拒绝,null 表示无文本。 */
    textBinding: automationPayerBindingSchema.nullable(),
  })
  .strict();

export const registerManagedRunSchema = z
  .object({
    callerKey: localId,
    caller: localId,
    executionId: localId,
    binding: executionBindingSchema,
    run: managedRunRegistrationSchema,
    authEpoch: z.string().uuid(),
    estimatedPoints: z.number().finite().nonnegative().nullable(),
    declaredBudgetPoints: z.number().finite().nonnegative().optional(),
    consent: z.literal('interactive').optional(),
    now: time,
  })
  .strict();

/** 子映射:originalJobId → callId / 本地生成行 / remoteKey 与其回执状态。 */
export const managedRunChildSchema = z
  .object({
    ordinal: z.number().int().nonnegative().max(3),
    originalJobId: localId,
    remoteKey: generationIdempotencyKeySchema,
    callId: localId.nullable().default(null),
    localGenerationId: localId.nullable().default(null),
    /** unclaimed 不是重启许可:只有创建它的活协调者能领取一次。 */
    submissionState: z.enum(['unclaimed', 'query_only']),
    receipt: generationExecutionReceiptSchema.nullable().default(null),
    cancelAcknowledgedAt: time.nullable().default(null),
  })
  .strict();

/** Run-level durable association; per-child state lives in the children mapping. */
export const managedRunRecordSchema = z
  .object({
    requestId: localId,
    callerKey: localId,
    namespace: z.string().uuid(),
    binding: executionBindingSchema,
    authEpoch: z.string().uuid(),
    runtimeEpoch: z.string().uuid(),
    run: managedRunRegistrationSchema,
    children: z.array(managedRunChildSchema).min(1).max(4),
    inputHash: hash,
    /** 用户取消意图先于远端取消落库;时间戳不代表费用为零。 */
    cancelRequestedAt: time.nullable().default(null),
    createdAt: time,
    updatedAt: time,
  })
  .strict()
  .superRefine((value, context) => {
    // 子映射与冻结的原图计划一一对应:数量、顺序与 ordinal 都不允许漂移。
    if (value.children.length !== value.run.originalJobIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['children'],
        message: 'Children must map the frozen original job plan one-to-one',
      });
      return;
    }
    for (const [index, child] of value.children.entries()) {
      if (child.ordinal !== index || child.originalJobId !== value.run.originalJobIds[index]) {
        context.addIssue({
          code: 'custom',
          path: ['children', index],
          message: 'Child ordinal and original job must match the frozen plan order',
        });
      }
    }
  });

export type ManagedRunChildInput = z.infer<typeof managedRunChildInputSchema>;
export type ManagedRunRegistration = z.infer<typeof managedRunRegistrationSchema>;
export type RegisterManagedRun = z.infer<typeof registerManagedRunSchema>;
export type ManagedRunChild = z.infer<typeof managedRunChildSchema>;
export type ManagedRunRecord = z.infer<typeof managedRunRecordSchema>;
