import { describe, expect, it } from 'vitest';
import {
  clampPetPosition,
  fromRelativePosition,
  petPositionFromCursor,
  petTravelDuration,
  toRelativePosition,
} from '../movement';

describe('pet window movement', () => {
  it('uses twice the previous travel time', () => {
    expect(petTravelDuration(100)).toBe(960);
    expect(petTravelDuration(600)).toBe(1_440);
    expect(petTravelDuration(2_000)).toBe(2_800);
  });

  it('keeps the whole pet window inside the page bounds', () => {
    const bounds = { x: 100, y: 80, width: 900, height: 600 };
    const size = { width: 160, height: 184 };

    expect(clampPetPosition({ x: 20, y: 20 }, bounds, size)).toEqual({ x: 100, y: 80 });
    expect(clampPetPosition({ x: 980, y: 680 }, bounds, size)).toEqual({ x: 840, y: 496 });
  });

  it('preserves the page-relative position when the main window moves', () => {
    const before = { x: 220, y: 150, width: 900, height: 600 };
    const after = { x: 520, y: 310, width: 900, height: 600 };
    const relative = toRelativePosition({ x: 840, y: 490 }, before);

    expect(fromRelativePosition(relative, after)).toEqual({ x: 1_140, y: 650 });
  });

  it('tracks the native cursor from a stable drag origin', () => {
    expect(petPositionFromCursor(
      { x: 100, y: 200 },
      { x: 140, y: 240 },
      { x: 315, y: 390 },
    )).toEqual({ x: 275, y: 350 });
  });

});
