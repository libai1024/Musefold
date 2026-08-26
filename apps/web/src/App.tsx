import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { GenerationJob, McpConnectionPage } from '@musefold/contracts';
import {
  formatAccountPoints,
  getProductCapabilities,
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
import { WebSidebar, WebTopbar, type WebView } from './layout/WebNavigation';
import { useKeyboardInset } from './layout/useKeyboardInset';
import { WebGatewayError, type WebGateway } from './runtime';
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
} from './workspace-query-cache';

type View = WebView;

const capabilities = getProductCapabilities('web');

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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
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
    enabled: Boolean(account) && !authRequired,
  });
  const connections = connectionsQuery.data ?? { items: [] };
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
    if (nextView !== 'settings') setSidebarOpen(true);
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
      sidebar={
        <WebSidebar
          view={view}
          settingsSection={settingsSection}
          accountName={account.displayName ?? account.username}
          mode={gateway.mode}
          promptCount={generate.libraryItems.length}
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
            onSearch={() => {
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
            dataSourceLabel={gateway.mode === 'fixture' ? '开发预览' : 'Musefold Cloud'}
            onRedeem={redeemAccountCode}
            onRefresh={accountQuery.refresh}
            redeemBusy={accountAction === 'redeem'}
            refreshBusy={accountQuery.refreshing}
            connections={connections}
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
    </ProductSidebarLayout>
  );
}
