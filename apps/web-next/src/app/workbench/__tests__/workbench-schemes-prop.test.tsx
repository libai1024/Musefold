// Web 工作台方案域集成 prop wiring 证据(P01-7):
// - WorkbenchScreen 收到 designSchemes prop,只含导航缝 onOpenDesignSchemes;
// - 提交缝 onRun/onCancelRun/onCreate/onModify 缺省(云端 run/创建/修改管线未部署,提交禁用并解释,不伪造);
// - 深链路由:带 detailId → /design-schemes?scheme=<id>,不带 → /design-schemes。

import type { MusefoldGateway } from '@musefold/platform';
import { PlatformProvider, WEB_CAPABILITIES } from '@musefold/platform';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import WorkbenchPage from '../page';

const routerPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
  usePathname: () => '/workbench',
  useSearchParams: () => new URLSearchParams(),
}));

const workbenchPropsSpy = vi.fn();
vi.mock('@musefold/features/workbench', async (importActual) => {
  const actual = await importActual<typeof import('@musefold/features/workbench')>();
  return {
    ...actual,
    WorkbenchScreen: (props: Record<string, unknown>) => {
      workbenchPropsSpy(props);
      return <div data-testid="workbench-stub" />;
    },
  };
});

function makeGateway(): MusefoldGateway {
  return {
    workbench: {
      listSessions: vi.fn(async () => ({ items: [], nextCursor: null })),
    },
  } as unknown as MusefoldGateway;
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const capabilities = { ...WEB_CAPABILITIES, hasDesignSchemes: true };
  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <PlatformProvider runtime={{ gateway: makeGateway(), capabilities }}>
          {children}
        </PlatformProvider>
      </QueryClientProvider>
    );
  }
  return render(<WorkbenchPage />, { wrapper: Providers });
}

beforeEach(() => {
  routerPush.mockClear();
  workbenchPropsSpy.mockClear();
});

describe('Web 工作台 designSchemes 集成 prop', () => {
  it('只接导航缝:prop 存在,onRun/onCancelRun/onCreate/onModify 均缺省(不伪造方案执行)', async () => {
    renderPage();
    await waitFor(() => expect(workbenchPropsSpy).toHaveBeenCalled());

    const props = workbenchPropsSpy.mock.calls.at(-1)?.[0] as {
      designSchemes?: {
        onOpenDesignSchemes(detailId?: string): void;
        onRun?: unknown;
        onCancelRun?: unknown;
        onCreate?: unknown;
        onModify?: unknown;
      };
    };
    expect(props.designSchemes).toBeDefined();
    expect(typeof props.designSchemes?.onOpenDesignSchemes).toBe('function');
    expect(props.designSchemes?.onRun).toBeUndefined();
    expect(props.designSchemes?.onCancelRun).toBeUndefined();
    expect(props.designSchemes?.onCreate).toBeUndefined();
    expect(props.designSchemes?.onModify).toBeUndefined();
  });

  it('onOpenDesignSchemes 深链路由:带 detailId 携 ?scheme= 参数,不带则纯路由', async () => {
    renderPage();
    await waitFor(() => expect(workbenchPropsSpy).toHaveBeenCalled());
    const props = workbenchPropsSpy.mock.calls.at(-1)?.[0] as {
      designSchemes?: { onOpenDesignSchemes(detailId?: string): void };
    };

    props.designSchemes?.onOpenDesignSchemes('scheme-9');
    expect(routerPush).toHaveBeenCalledWith('/design-schemes?scheme=scheme-9');

    props.designSchemes?.onOpenDesignSchemes();
    expect(routerPush).toHaveBeenCalledWith('/design-schemes');
  });
});
