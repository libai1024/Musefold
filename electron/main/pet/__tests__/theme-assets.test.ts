import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PetThemeManifest } from '@shared/types/pet';

const root = join(process.cwd(), 'resources/pet/cat');
const theme = JSON.parse(
  readFileSync(join(root, 'theme.json'), 'utf8'),
) as PetThemeManifest;

describe('Musefold cat theme assets', () => {
  it('defines high-frame-rate left and right running loops', () => {
    for (const state of ['run-left', 'run-right']) {
      const definition = theme.states[state];
      expect(definition).toBeDefined();
      expect(definition.file.endsWith('.apng')).toBe(true);
      expect(definition.loop).toBe('subloop');
    }
  });

  it('references only existing 256px RGBA APNG files with at least 48 frames', () => {
    const definitions = {
      ...theme.states,
      ...theme.transitions,
      ...theme.reactions,
    };
    for (const definition of Object.values(definitions)) {
      for (const relative of definition.files ?? [definition.file]) {
        const file = join(root, relative);
        expect(existsSync(file), relative).toBe(true);
        const png = readFileSync(file);
        expect(png.readUInt32BE(16), relative).toBe(256);
        expect(png.readUInt32BE(20), relative).toBe(256);
        expect(png[25], relative).toBe(6);
        const animationControl = png.indexOf(Buffer.from('acTL'));
        expect(animationControl, relative).toBeGreaterThan(0);
        expect(png.readUInt32BE(animationControl + 4), relative).toBeGreaterThanOrEqual(48);
      }
    }
  });
});
