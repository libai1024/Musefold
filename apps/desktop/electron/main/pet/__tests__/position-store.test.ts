import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadPetDesktopPosition, savePetDesktopPosition } from '../position-store';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'musefold-pet-position-'));
  roots.push(root);
  return root;
}

describe('pet desktop position store', () => {
  it('round-trips the last desktop position', () => {
    const root = tempRoot();
    savePetDesktopPosition(root, { x: 321.4, y: 654.6 });

    expect(loadPetDesktopPosition(root)).toEqual({ x: 321, y: 655 });
    expect(JSON.parse(readFileSync(join(root, 'pet-desktop-position.json'), 'utf8')))
      .toEqual({ x: 321, y: 655 });
  });

  it('ignores missing, malformed, and non-finite positions', () => {
    const root = tempRoot();
    expect(loadPetDesktopPosition(root)).toBeNull();

    writeFileSync(join(root, 'pet-desktop-position.json'), '{broken', 'utf8');
    expect(loadPetDesktopPosition(root)).toBeNull();

    writeFileSync(join(root, 'pet-desktop-position.json'), JSON.stringify({ x: null, y: 20 }), 'utf8');
    expect(loadPetDesktopPosition(root)).toBeNull();
  });
});
