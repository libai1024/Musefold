import { describe, expect, it } from 'vitest';
import {
  composePromptWithRatioConstraint,
  RATIO_CONSTRAINT_PREFIX,
  ratioPromptConstraint,
} from '../promptConstraints';

describe('workbench ratio prompt constraint', () => {
  it('injects the selected ratio into the final provider prompt', () => {
    expect(composePromptWithRatioConstraint('电影感人像', '16:9')).toBe(
      `电影感人像\n\n${RATIO_CONSTRAINT_PREFIX}严格按照 16:9 画幅构图；主体、留白和所有关键元素均需完整适配该比例，不得改用其他画幅。`,
    );
  });

  it('does not duplicate a constraint across refinement turns', () => {
    const constrained = composePromptWithRatioConstraint('电影感人像', '4:5');
    expect(composePromptWithRatioConstraint(`${constrained}\n\n微调要求：\n增加留白`, '4:5')).toBe(
      `${constrained}\n\n微调要求：\n增加留白`,
    );
  });

  it('leaves automatic ratio prompts unconstrained', () => {
    expect(ratioPromptConstraint('auto')).toBe('');
    expect(composePromptWithRatioConstraint('自由构图', 'auto')).toBe('自由构图');
  });
});
