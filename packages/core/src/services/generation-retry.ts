import { GenerationDispatchError } from '../providers/execution';

/** Legacy local rows used "unknown" when no model was captured. Never infer it from today's default. */
export function assertLocalRetryModel(model: unknown): asserts model is string {
  if (typeof model !== 'string' || !model.trim() || model.trim().toLowerCase() === 'unknown')
    throw new GenerationDispatchError(
      'GENERATION_RETRY_MODEL_MISSING',
      '原任务缺少可核对的模型，无法按原参数重试。请在连接设置中确认模型，再到工作台新建生成。',
    );
}
