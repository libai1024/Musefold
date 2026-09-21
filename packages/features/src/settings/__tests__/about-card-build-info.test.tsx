import type { MusefoldGateway } from '@musefold/platform';
import { type BuildInfo, PlatformProvider, WEB_CAPABILITIES } from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { AboutCard, formatVersionInfo, formatWebVersionLine } from '../AboutCard';

function renderAbout(buildInfo?: BuildInfo) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const gateway = {} as MusefoldGateway;
  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <PlatformProvider
          runtime={{ gateway, capabilities: WEB_CAPABILITIES }}
          buildInfo={buildInfo}
        >
          {children}
        </PlatformProvider>
      </QueryClientProvider>
    );
  }
  return render(<AboutCard />, { wrapper: Providers });
}

describe('AboutCard Web 构建标识(B2-T6 / 07-07 P3)', () => {
  it('无 buildInfo:版本行仍是「Web 版」(不假造版本号)', () => {
    expect(formatWebVersionLine()).toBe('Web 版');
    expect(formatWebVersionLine({})).toBe('Web 版');
    renderAbout();
    expect(screen.getByTestId('settings-about-version').textContent).toBe('Web 版');
  });

  it('有 version / commit:版本行 Web 版 · {version} · 前 7 位', () => {
    const buildInfo = {
      version: '2.5.0',
      commit: 'abcdef1234567890',
      builtAt: '2026-09-06T10:00:00.000Z',
    };
    expect(formatWebVersionLine(buildInfo)).toBe('Web 版 · 2.5.0 · abcdef1');
    renderAbout(buildInfo);
    expect(screen.getByTestId('settings-about-version').textContent).toBe(
      'Web 版 · 2.5.0 · abcdef1',
    );
    const copied = formatVersionInfo(null, buildInfo);
    expect(copied).toContain('形态:Web 版');
    expect(copied).toContain('版本:2.5.0');
    expect(copied).toContain('构建:abcdef1');
    expect(copied).toContain('构建时间:2026-09-06T10:00:00.000Z');
  });
});
