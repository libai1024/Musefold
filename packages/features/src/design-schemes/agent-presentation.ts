import {
  createDesignSchemeInputSchema,
  cloudModifyDesignSchemeInputSchema,
  type DesignSchemeAgentSession,
  type StartDesignSchemeAgentInput,
} from '@musefold/contracts';
import type { SchemeCreateSubmission, SchemeModifySubmission } from './integration-store';

export const AGENT_STATUS_LABELS: Record<DesignSchemeAgentSession['status'], string> = {
  queued: '排队中',
  preparing: '正在准备来源',
  compiling: '正在整理方案',
  'confirmation-required': '等待来源确认',
  'authorization-required': '等待编译授权',
  completed: '草稿已完成',
  blocked: '任务需要处理',
  failed: '任务未完成',
  cancelled: '已取消',
  expired: '已过期',
  'no-source': '没有可检查的来源',
  'up-to-date': '来源没有更新',
};
export const AGENT_BLOCKER_LABELS: Record<
  NonNullable<DesignSchemeAgentSession['blocker']>,
  string
> = {
  AGENT_COMPILER_UNAVAILABLE: '方案编译暂不可用，请稍后核对服务。',
  AGENT_ASSETS_UNAVAILABLE: '当前服务暂不能处理所选素材。',
  AGENT_MATERIALS_INVALID: '所选素材已变化或不可用，请核对原来源。',
  SOURCE_PREPARATION_FAILED: '来源准备未完成，请核对仓库访问与来源记录。',
  AGENT_TEXT_AUTHORIZATION_UNAVAILABLE: '文本执行授权已失效，请核对账号与模型。',
  AGENT_TEXT_RESULT_UNKNOWN: '模型调用结果尚不确定，请核对原任务；不会自动重新发送。',
  AGENT_TEXT_OUTPUT_INVALID: '模型结果未通过方案校验，本次没有提交草稿。',
  AGENT_TEXT_SOURCE_INVALID: '来源依据未通过校验，本次没有提交草稿。',
  AGENT_BASE_REVISION_CHANGED: '方案版本已经变化，本次没有覆盖新的版本。',
};
export const AGENT_OPERATION_LABELS = {
  create: '创建方案',
  modify: '修改方案',
  'check-update': '检查来源更新',
};
export function agentIsTerminal(session: DesignSchemeAgentSession) {
  return [
    'completed',
    'blocked',
    'failed',
    'cancelled',
    'expired',
    'no-source',
    'up-to-date',
  ].includes(session.status);
}

/** Only explicit GitHub URLs become sources. Server resolves and freezes their actual ref/commit. */
export function toCloudSchemeCreateInput(submission: SchemeCreateSubmission) {
  const sourceUris: string[] = [];
  const brief = submission.brief
    .replace(/https:\/\/github\.com\/[^\s<>"'）)\]，。；]+/giu, (candidate) => {
      const url = new URL(candidate);
      if (
        url.hostname !== 'github.com' ||
        url.username ||
        url.password ||
        url.port ||
        url.search ||
        url.hash ||
        url.pathname.split('/').filter(Boolean).length < 2
      )
        throw new Error('请提供没有查询参数或凭据的 GitHub 仓库地址');
      if (!sourceUris.includes(url.href)) sourceUris.push(url.href);
      return '';
    })
    .trim();
  const historySources =
    submission.source?.kind === 'history'
      ? submission.source.selection.items.map((item) => ({
          runId: item.jobId,
          assetId: item.assetId,
          includePrompt: item.prompt !== null,
        }))
      : [];
  if (!brief && !sourceUris.length && !historySources.length)
    throw new Error('请描述方案想法或选择来源');
  return createDesignSchemeInputSchema.parse({
    executionId: submission.executionId,
    brief,
    sourceUris,
    sourceBindings: [],
    sourceAssetIds: [],
    historySources,
  });
}

/** UI intent uses canonical operation/input shapes, before independent text consent exists. */
export type SchemeAgentIntent =
  | Pick<Extract<StartDesignSchemeAgentInput, { operation: 'create' }>, 'operation' | 'input'>
  | Pick<Extract<StartDesignSchemeAgentInput, { operation: 'modify' }>, 'operation' | 'input'>
  | Extract<StartDesignSchemeAgentInput, { operation: 'check-update' }>;

export function toCloudSchemeModifyInput(submission: SchemeModifySubmission) {
  return cloudModifyDesignSchemeInputSchema.parse({
    executionId: submission.executionId,
    schemeId: submission.attachment.schemeId,
    baseRevisionId: submission.attachment.revisionId,
    expectedVersion: submission.attachment.expectedVersion,
    instruction: submission.brief.trim(),
  });
}
export function agentIntentCallLimit(
  intent: Exclude<SchemeAgentIntent, { operation: 'check-update' }>,
) {
  return intent.operation === 'modify' ? 1 : intent.input.sourceUris.length + 1;
}
