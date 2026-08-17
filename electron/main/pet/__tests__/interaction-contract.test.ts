import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const controller = readFileSync('electron/main/pet/index.ts', 'utf8');
const windowSource = readFileSync('electron/main/pet/window.ts', 'utf8');
const renderer = readFileSync('src/pet/PetApp.tsx', 'utf8');
const application = readFileSync('electron/main/application.ts', 'utf8');

describe('pet interaction contract', () => {
  it('opens the main window only from an explicit double-click action', () => {
    expect(renderer).toContain("window.api.pet.interact('pointer-down')");
    expect(renderer).toContain("onDoubleClick={() => window.api.pet.interact('open-main')}");
    expect(controller).toContain("if (interaction === 'pointer-down')");
    expect(controller).toContain("if (interaction === 'open-main')");
    expect(controller).toContain('openMainWindowFromPet()');
    expect(application).toContain('if (isPetActivationSuppressed()) return;');
    expect(windowSource).toContain("type: process.platform === 'darwin' ? 'panel' : undefined");
    expect(windowSource).toContain('focusable: false');
  });

  it('tracks dragging from the native cursor instead of renderer move events', () => {
    expect(controller).toContain('screen.getCursorScreenPoint()');
    expect(controller).toContain('setInterval(updatePetDragPosition, 16)');
    expect(renderer).not.toContain('window.api.pet.moveBy(dx, dy)');
  });

  it('keeps the pet off by default and preserves the explicit user setting', () => {
    expect(controller).toContain('let enabled = false;');
    expect(controller).toContain('if (next) enablePet();');
    expect(application).not.toContain('startPetCompanion');
    expect(application).not.toMatch(/\benablePet\(/);
    expect(application).toContain('const petDetail = isPetEnabled()');
    expect(application).toContain('桌宠当前已关闭，最小化到托盘后会保持隐藏。');
  });

  it('shows the active work state when the pet is enabled during a generation', () => {
    expect(controller).toContain('if (activity.runningJobs > 0)');
    expect(controller).toContain('machine.setState(stateForJobs(activity.runningJobs), true);');
    expect(controller).not.toContain('activity.reset();');
  });
});
