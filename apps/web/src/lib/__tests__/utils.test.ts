import { describe, expect, it } from 'vitest';
import { cn } from '../utils';

describe('cn', () => {
  it('joins active class names and ignores inactive values', () => {
    expect(cn('text-primary', false, undefined, 'hover:bg-hover', null)).toBe(
      'text-primary hover:bg-hover',
    );
  });
});
