import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('desktop navigation wiring', () => {
  it('uses design schemes as the reusable workflow surface and exposes no recipe route', () => {
    const sidebar = source('src/components/layout/Sidebar.tsx');
    const commandPalette = source('src/components/command/CommandPalette.tsx');
    const app = source('src/App.tsx');

    expect(sidebar).toContain("key: 'design-schemes'");
    expect(sidebar).toContain('data-testid={`nav-${item.key}`}');
    expect(sidebar).not.toContain("key: 'recipes'");

    expect(commandPalette).toContain("id: 'nav-design-schemes'");
    expect(commandPalette).toContain("go('design-schemes')");
    expect(commandPalette).not.toContain("id: 'nav-recipes'");

    expect(app).toContain("'design-schemes': DesignSchemesPage");
    expect(app).not.toContain('RecipesPage');
    expect(app).not.toContain('recipes:');
  });

  it('exposes design scheme stores through the E2E hook without legacy recipe helpers', () => {
    const testHook = source('src/lib/test-hook.ts');

    expect(testHook).toContain('schemeCreation: useSchemeCreationStore');
    expect(testHook).toContain('schemeRun: useSchemeRunStore');
    expect(testHook).not.toContain('RecipeRoute');
    expect(testHook).not.toContain('useRecipe');
  });

  it('offers an app restart instead of exposing missing conversation IPC errors', () => {
    const sidebar = source('src/components/layout/Sidebar.tsx');

    expect(sidebar).toContain('WORKBENCH_SESSION_RESTART_REQUIRED');
    expect(sidebar).toContain('workbench-session-relaunch');
    expect(sidebar).toContain('api.system.relaunch()');
    expect(sidebar).not.toContain('{error}，点击重试');
  });
});
