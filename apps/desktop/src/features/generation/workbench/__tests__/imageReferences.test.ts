import { describe, expect, it } from 'vitest';
import {
  MULTI_IMAGE_INDEX_HINT,
  REFINEMENT_SUPPORTING_IMAGES_HINT,
  REFINEMENT_TARGET_IMAGE_HINT,
  composePromptWithRefinementImageHint,
} from '../imageReferences';

describe('refinement image prompt hints', () => {
  it('marks the first image as the refinement target', () => {
    expect(composePromptWithRefinementImageHint('增加留白', 1)).toBe(
      `${REFINEMENT_TARGET_IMAGE_HINT}\n\n增加留白`,
    );
  });

  it('describes later images as user-directed supporting inputs', () => {
    expect(composePromptWithRefinementImageHint('学习图 2 的风格', 2)).toBe(
      `${REFINEMENT_TARGET_IMAGE_HINT}${REFINEMENT_SUPPORTING_IMAGES_HINT}\n\n学习图 2 的风格`,
    );
  });

  it('replaces an inherited image hint instead of stacking roles', () => {
    const inherited = `${MULTI_IMAGE_INDEX_HINT}\n\n原始提示词`;
    expect(composePromptWithRefinementImageHint(inherited, 1)).toBe(
      `${REFINEMENT_TARGET_IMAGE_HINT}\n\n原始提示词`,
    );
  });
});
