// 比例约束的实现移到 shared/generation-prompt.ts，主进程 Skill Agent 复用同一份措辞。
export {
  RATIO_CONSTRAINT_PREFIX,
  ratioPromptConstraint,
  composePromptWithRatioConstraint,
} from '@shared/generation-prompt';
