import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8');
const historyView = readFileSync(new URL('../views/HistoryView.tsx', import.meta.url), 'utf8');
const libraryView = readFileSync(new URL('../views/PromptLibraryView.tsx', import.meta.url), 'utf8');

describe('web host boundary', () => {
  it('assembles the shared QueryClient at the window root', () => {
    expect(mainSource).toMatch(/createMusefoldQueryClient/);
    expect(mainSource).toMatch(/QueryClientProvider/);
  });

  it('injects PlatformServices at the host instead of product-ui', () => {
    expect(mainSource).toMatch(/webPlatformServices/);
    expect(mainSource).toMatch(/createWebGateway/);
    expect(mainSource).toMatch(/platform=\{webPlatformServices\}/);
  });

  it('keeps page implementations outside the route and adapter host', () => {
    expect(appSource).toMatch(/from ["']\.\/layout\/WebNavigation["']/);
    expect(appSource).toMatch(/from ["']\.\/views\/GenerateView["']/);
    expect(appSource).toMatch(/from ["']\.\/views\/PromptLibraryView["']/);
    expect(appSource).toMatch(/from ["']\.\/views\/HistoryView["']/);
    expect(appSource).not.toMatch(
      /function (GenerateView|PromptLibraryView|HistoryView|Sidebar|Topbar|MobileNavigation)\s*\(/,
    );
    expect(appSource).not.toMatch(/onListTrash/);
    expect(appSource).toMatch(/platform=\{platform\}/);
    expect(historyView).toMatch(/useHistoryPageController/);
    expect(libraryView).toMatch(/useLibraryPageController/);
  });
});
