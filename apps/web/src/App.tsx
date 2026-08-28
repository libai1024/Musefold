import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { GenerationJob, McpConnectionPage } from '@musefold/contracts';
import {
  formatAccountPoints,
  type PlatformServices,
} from '@musefold/domain';
import {
  ProductSidebarLayout,
  clearMusefoldUserQueryCache,
  createGenerationTerminalObserver,
  musefoldQueryKeys,
  useAccountQueryController,
  useGeneratePageController,
} from '@musefold/product-ui';
import { WebCommandPalette } from './layout/WebCommandPalette';
import { WebSidebar, WebTopbar, type WebView } from './layout/WebNavigation';
import { useLargeProductViewport } from './layout/useLargeProductViewport';
import { useKeyboardInset } from './layout/useKeyboardInset';
import { WebGatewayError, type WebGateway } from './runtime';
import {
  createWebCapabilityManifest,
  webCapabilitiesFromManifest,
} from './runtime/capabilities';
import { GenerateView } from './views/GenerateView';
import { HistoryView } from './views/HistoryView';
import { PromptLibraryView } from './views/PromptLibraryView';
import { WebSettingsView, type WebSettingsSection } from './views/SettingsView';
import { ApprovalScreen, FailureScreen, LoadingScreen, LoginScreen } from './screens/BootScreens';
import { loadWebWorkspace } from './load-workspace';
import { replaceWorkbenchSessionUrl } from './workbench-session-url';
import {
  dropHistoryJob,
  hydrateWorkspaceLists,
  patchHistoryJob,
  patchLibraryPrompt,
  WEB_LIBRARY_LIST_KEY,
} from './workspace-query-cache';

type View = WebView;

interface AppProps {
  gateway: WebGateway;
  platform: PlatformServices;
}

export function App({ gateway, platform }: AppProps) {
  useKeyboardInset();
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>('generate');
  const [settingsSection, setSettingsSection] = useState<WebSettingsSection>('account');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [promptQuery, setPromptQuery] = useState('');
  const [commandOpen, setCommandOpen] = useState(false);
  const largeViewport = useLargeProductViewport();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const enterAuthState = useCallback(() => {
    clearMusefoldUserQueryCache(queryClient);
    setAuthRequired(true);
  }, [queryClient]);
  const handleAccountRefreshError = useCallback(
    (error: unknown) => {
      if (
        error instanceof WebGatewayError &&
        ['AUTH_REQUIRED', 'AUTH_SESSION_EXPIRED'].includes(error.code)
      ) {
        enterAuthState();
      }
    },
    [enterAuthState],
  );
  const accountQuery = useAccountQueryController({
    account: gateway,
    enabled: !authRequired,
    onRefreshError: handleAccountRefreshError,
  });
  const account = accountQuery.account;
  const capabilityManifest = useMemo(
    () => createWebCapabilityManifest({ signedIn: Boolean(account) && !authRequired, online }),
    [account, authRequired, online],
  );
  const capabilities = useMemo(
    () => webCapabilitiesFromManifest(capabilityManifest),
    [capabilityManifest],
  );
  const [accountAction, setAccountAction] = useState<'redeem' | null>(null);
  const handleAccountActionError = useCallback(
    (error: unknown) => {
      if (
        error instanceof WebGatewayError &&
        ['AUTH_REQUIRED', 'AUTH_SESSION_EXPIRED'].includes(error.code)
      ) {
        enterAuthState();
      }
    },
    [enterAuthState],
  );
  const redeemAccountCode = useCallback(
    async (code: string) => {
      setAccountAction('redeem');
      try {
        const result = await gateway.redeem(code);
        await accountQuery.refresh();
        return result.creditedQuota;
      } catch (error) {
        handleAccountActionError(error);
        throw error;
      } finally {
        setAccountAction(null);
      }
    },
    [accountQuery.refresh, gateway, handleAccountActionError],
  );
  const connectionsQuery = useQuery<McpConnectionPage>({
    queryKey: musefoldQueryKeys.connections.all,
    queryFn: () => gateway.listConnections(),
    enabled: Boolean(account) && !authRequired && capabilities.cloudMcpConnections,
  });
  const connections = connectionsQuery.data ?? { items: [] };
  // 命令面板的提示词命中：读取 library 列表缓存（workspace 水合已写入），面板打开时刷新。
  const commandPromptQuery = useQuery({
    queryKey: musefoldQueryKeys.library.list(WEB_LIBRARY_LIST_KEY),
    queryFn: () => gateway.listPrompts({ ...WEB_LIBRARY_LIST_KEY }),
    enabled: commandOpen,
  });
  const terminalObserver = useRef(
    createGenerationTerminalObserver(() => {
      void accountQuery.scheduleRefresh();
    }),
  );
  const handleHistoryJob = useCallback(
    (job: GenerationJob) => {
      patchHistoryJob(queryClient, job);
      terminalObserver.current.observe(job);
    },
    [queryClient],
  );
  const approvalRequest = useMemo(() => {
    const match = window.location.pathname.match(/\/approvals\/([^/]+)$/);
    const token = new URLSearchParams(window.location.search).get('token');
    return match && token ? { id: decodeURIComponent(match[1]), token } : null;
  }, []);
  const [approvalJob, setApprovalJob] = useState<GenerationJob | null>(null);
  const [approvalLoading, setApprovalLoading] = useState(false);

  const generate = useGeneratePageController({
    workbench: gateway,
    generation: gateway,
    prompts: gateway,
    history: gateway,
    platform,
    listEnabled: Boolean(account),
    canGenerate: Boolean(account?.canGenerate && capabilities.generation),
    isConflictError: (error) =>
      error instanceof WebGatewayError && error.code === 'WORKBENCH_VERSION_CONFLICT',
    onShowGenerate: () => setView('generate'),
    onSessionUrlChange: replaceWorkbenchSessionUrl,
    onAuthRequired: enterAuthState,
    onHistoryJob: handleHistoryJob,
    onLibraryPrompt: (prompt) => patchLibraryPrompt(queryClient, prompt),
  });

  const openProductView = (nextView: View) => {
    setView(nextView);
    setSidebarOpen(nextView !== 'settings');
  };

  const openSettingsSection = (section: WebSettingsSection) => {
    setSettingsSection(section);
    setView('settings');
    setSidebarOpen(false);
  };

  const loadWorkspace = async () => {
    generate.resetDraft();
    setLoading(true);
    setLoadError(null);
    try {
      const snapshot = await loadWebWorkspace(gateway);
      hydrateWorkspaceLists(queryClient, snapshot.prompts, snapshot.history);
      generate.hydrate({
        sessions: snapshot.workbenchPage.items,
        selected: snapshot.selected,
        snapshots: snapshot.snapshotItems,
        sessionJobs: snapshot.sessionJobs,
        prompts: snapshot.prompts.items,
      });
    } catch (error) {
      if (
        error instanceof WebGatewayError &&
        ['AUTH_REQUIRED', 'AUTH_SESSION_EXPIRED'].includes(error.code)
      ) {
        enterAuthState();
      } else {
        setLoadError(error instanceof Error ? error.message : '无法载入 Musefold');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const queryError = accountQuery.error ?? connectionsQuery.error;
    if (
      queryError instanceof WebGatewayError &&
      ['AUTH_REQUIRED', 'AUTH_SESSION_EXPIRED'].includes(queryError.code)
    ) {
      enterAuthState();
    }
  }, [accountQuery.error, connectionsQuery.error, enterAuthState]);

  useEffect(() => {
    void loadWorkspace();
  }, [gateway]);

  useEffect(() => {
    if (!account || !approvalRequest) return;
    setApprovalLoading(true);
    gateway
      .getGeneration(approvalRequest.id)
      .then((next) => {
        generate.setActionError(null);
        setApprovalJob(next);
        generate.upsertJob(next);
      })
      .catch((error) =>
        generate.setActionError(error instanceof Error ? error.message : '审批任务无法载入'),
      )
      .finally(() => setApprovalLoading(false));
  }, [account, approvalRequest, gateway]);

  if (loading || accountQuery.loading) return <LoadingScreen />;
  if (authRequired) {
    return (
      <LoginScreen
        gateway={gateway}
        onAuthenticated={() => {
          setView('generate');
          void accountQuery.refresh().then(
            () => {
              setAuthRequired(false);
              void loadWorkspace();
            },
            (error) => {
              if (
                error instanceof WebGatewayError &&
                ['AUTH_REQUIRED', 'AUTH_SESSION_EXPIRED'].includes(error.code)
              ) {
                enterAuthState();
              } else {
                setLoadError(error instanceof Error ? error.message : '无法载入 Musefold');
              }
            },
          );
        }}
      />
    );
  }
  if (approvalRequest) {
    return (
      <ApprovalScreen
        job={approvalJob}
        loading={approvalLoading}
        error={generate.actionError}
        onApprove={async () => {
          if (!approvalRequest || !approvalJob) return;
          try {
            const next = await gateway.approveGeneration(approvalRequest.id, approvalRequest.token);
            generate.setActionError(null);
            setApprovalJob(next);
            generate.upsertJob(next);
          } catch (error) {
            generate.setActionError(
              error instanceof Error ? error.message : '审批失败，请稍后重试',
            );
          }
        }}
      />
    );
  }
  if (loadError || !account) {
    return (
      <FailureScreen message={loadError ?? '会话不可用'} onRetry={() => void loadWorkspace()} />
    );
  }

  return (
    <ProductSidebarLayout
      open={sidebarOpen}
      onOpenChange={setSidebarOpen}
      compactDismissKey={view}
      className={view === 'settings' ? 'settings-product-shell' : undefined}
      sidebar={
        <WebSidebar
          capabilities={capabilities}
          view={view}
          accountName={account.displayName ?? account.username}
          quotaLabel={`${formatAccountPoints(account.quota)} 积分`}
          accountReady={Boolean(account.canGenerate && capabilities.generation && online)}
          onNavigate={openProductView}
          onSettingsSectionChange={openSettingsSection}
          workbenchSessions={generate.sessionItems}
          sessionListLoading={generate.sessionListLoading}
          sessionListError={generate.sessionListError}
          onNewDesign={() => void generate.beginNewDesign()}
          onCollapse={() => setSidebarOpen(false)}
          onOpenWorkbenchSession={(item) => void generate.openSession(item.id)}
          onArchiveWorkbenchSession={(item) => void generate.archiveSession(item.id)}
          onRenameWorkbenchSession={(item, title) => generate.renameSession(item, title)}
          onDeleteWorkbenchSession={(item) => generate.deleteSession(item)}
          onRetryWorkbenchSessions={() => void generate.refreshSessions()}
          onLogout={async () => {
            await gateway.logout();
            enterAuthState();
          }}
        />
      }
    >
      {/* app-main 类名保留：680px 媒体块的 100dvh / 键盘 inset 规则挂在它上（批次 5 收口）。
          v2.0 Phase B:背景上移到 MainView surface(bg-work),main 自身保持透明。 */}
      <main className="app-main flex min-h-0 min-w-0 flex-1 flex-col" data-ui-register="operate">
        {view !== 'settings' ? (
          <WebTopbar
            view={view}
            quota={`${formatAccountPoints(account.quota)} 积分`}
            mode={gateway.mode}
            workbenchTitle={generate.session?.title ?? null}
            workbenchSession={
              generate.sessionItems.find((item) => item.id === generate.session?.id) ?? null
            }
            sidebarOpen={sidebarOpen}
            onOpenSidebar={() => setSidebarOpen(true)}
            commandPaletteEnabled={largeViewport}
            onSearch={() => {
              // 大屏：与 Desktop 等价的命令面板入口；小屏维持既有提示词库跳转（shell 约束）。
              if (largeViewport) {
                setCommandOpen(true);
                return;
              }
              setView('prompts');
              window.requestAnimationFrame(() => {
                document.querySelector<HTMLInputElement>('[data-testid="library-search"]')?.focus();
              });
            }}
            onRenameSession={(item, title) => generate.renameSession(item, title)}
            onArchiveSession={(item) => generate.archiveSession(item.id)}
            onDeleteSession={(item) => generate.deleteSession(item)}
          />
        ) : null}
        {view === 'generate' && (
          <GenerateView
            page={generate}
            onOpenPromptLibrary={() => setView('prompts')}
            onOpenHistory={() => setView('history')}
          />
        )}
        {view === 'prompts' && (
          <PromptLibraryView
            prompts={gateway}
            platform={platform}
            query={promptQuery}
            onQueryChange={setPromptQuery}
            onUse={async (prompt) => {
              setPromptQuery('');
              await generate.applyPrompt(prompt);
            }}
          />
        )}
        {view === 'history' && (
          <HistoryView
            history={gateway}
            generation={gateway}
            platform={platform}
            onReuse={(nextJob) => void generate.reuse(nextJob)}
            onSavePrompt={generate.createPromptFromGeneration}
            onJobChanged={(job) => {
              generate.upsertJob(job);
              handleHistoryJob(job);
            }}
            onJobRemoved={(id) => {
              dropHistoryJob(queryClient, id);
              generate.dropJob(id);
            }}
          />
        )}
        {view === 'settings' && (
          <WebSettingsView
            section={settingsSection}
            onSectionChange={setSettingsSection}
            onBack={() => openProductView('generate')}
            gateway={gateway}
            account={account}
            capabilities={capabilities}
            dataSourceLabel={gateway.mode === 'fixture' ? '开发预览' : 'Musefold Cloud'}
            onRedeem={redeemAccountCode}
            onRefresh={accountQuery.refresh}
            redeemBusy={accountAction === 'redeem'}
            refreshBusy={accountQuery.refreshing}
            connections={connections}
            connectionsLoading={connectionsQuery.isPending || connectionsQuery.isFetching}
            connectionsError={
              connectionsQuery.error instanceof Error ? connectionsQuery.error.message : null
            }
            onConnectionsChange={(next) =>
              queryClient.setQueryData(musefoldQueryKeys.connections.all, next)
            }
            onLogout={async () => {
              await gateway.logout();
              enterAuthState();
            }}
          />
        )}
      </main>
      <WebCommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        capabilities={capabilities}
        sessions={generate.sessionItems}
        prompts={commandPromptQuery.data?.items ?? []}
        onNewDesign={() => void generate.beginNewDesign()}
        onNavigate={openProductView}
        onOpenSession={(sessionId) => void generate.openSession(sessionId)}
        onUsePrompt={async (prompt) => {
          setPromptQuery('');
          await generate.applyPrompt(prompt);
        }}
      />
    </ProductSidebarLayout>
  );
}
