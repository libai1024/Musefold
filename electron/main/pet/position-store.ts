import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PetPoint } from './movement';

const POSITION_FILE = 'pet-desktop-position.json';

function isPetPoint(value: unknown): value is PetPoint {
  if (!value || typeof value !== 'object') return false;
  const point = value as Partial<PetPoint>;
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

export function loadPetDesktopPosition(userDataDir: string): PetPoint | null {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(join(userDataDir, POSITION_FILE), 'utf8'),
    );
    if (!isPetPoint(parsed)) return null;
    return { x: Math.round(parsed.x), y: Math.round(parsed.y) };
  } catch {
    return null;
  }
}

export function savePetDesktopPosition(userDataDir: string, point: PetPoint): void {
  if (!isPetPoint(point)) return;
  try {
    mkdirSync(userDataDir, { recursive: true });
    const target = join(userDataDir, POSITION_FILE);
    const temporary = `${target}.tmp`;
    writeFileSync(temporary, JSON.stringify({ x: Math.round(point.x), y: Math.round(point.y) }), {
      encoding: 'utf8',
      mode: 0o600,
    });
    renameSync(temporary, target);
  } catch {
    // 坐标持久化失败不应影响桌宠本身运行。
  }
}
