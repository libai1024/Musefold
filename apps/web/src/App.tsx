import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AccountSession, GenerationJob, McpConnectionPage } from '@musefold/contracts';
import {
  formatAccountPoints,
  getProductCapabilities,
  type PlatformServices,
} from '@musefold/domain';
import { ProductSidebarLayout, useGeneratePageController } from '@musefold/product-ui';
import { WebSidebar, WebTopbar, type WebView } from './layout/WebNavigation';
import { useKeyboardInset } from './layout/useKeyboardInset';
import { WebGatewayError, type WebGateway } from './runtime';
import { GenerateView } from './views/GenerateView';
import { HistoryView } from './views/HistoryView';
import { PromptLibraryView } from './views/PromptLibraryView';
import { WebSettingsView, type WebSettingsSection } from './views/SettingsView';
import {
  ApprovalScreen,
  FailureScreen,
  LoadingScreen,
  LoginScreen,
} from './screens/BootScreens';
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
  const [session, setSession] = useState<AccountSession | null>(null);
  const [promptQuery, setPromptQuery] = useState('');
  const [connections, setConnections] = useState<McpConnectionPage>({ items: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
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
    listEnabled: Boolean(session),
    canGenerate: Boolean(session?.account.canGenerate && capabilities.generation),
    isConflictError: (error) =>
      error instanceof WebGatewayError && error.code === 'WORKBENCH_VERSION_CONFLICT',
    onShowGenerate: () => setView('generate'),
    onSessionUrlChange: replaceWorkbenchSessionUrl,
    onAuthRequired: () => setAuthRequired(true),
    onHistoryJob: (job) => patchHistoryJob(queryClient, job),
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
      setSession(snapshot.session);
      hydrateWorkspaceLists(queryClient, snapshot.prompts, snapshot.history);
      setConnections(snapshot.connections);
      generate.hydrate({
        sessions: snapshot.workbenchPage.items,
        selected: snapshot.selected,
        snapshots: snapshot.snapshotItems,
        sessionJobs: snapshot.sessionJobs,
        prompts: snapshot.prompts.items,
      });
      setAuthRequired(false);
    } catch (error) {
      if (
        error instanceof WebGatewayError &&
        ['AUTH_REQUIRED', 'AUTH_SESSION_EXPIRED'].includes(error.code)
      ) {
        setAuthRequired(true);
      } else {
        setLoadError(error instanceof Error ? error.message : '无法载入 Musefold');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadWorkspace();
  }, [gateway]);

  useEffect(() => {
    if (!session || !approvalRequest) return;
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
  }, [approvalRequest, gateway, session]);

  if (loading) return <LoadingScreen />;
  if (authRequired) {
    return <LoginScreen gateway={gateway} onAuthenticated={() => void loadWorkspace()} />;
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
            generate.setActionError(error instanceof Error ? error.message : '审批失败，请稍后重试');
          }
        }}
      />
    );
  }
  if (loadError || !session) {
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
          accountName={session.account.displayName ?? session.account.username}
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
      {/* app-main 类名保留：680px 媒体块的 100dvh / 键盘 inset 规则挂在它上（批次 5 收口） */}
      <main
        className="app-main flex min-h-0 min-w-0 flex-1 flex-col bg-elevated"
        data-ui-register="operate"
      >
        {view !== 'settings' ? (
          <WebTopbar
            view={view}
            quota={`${formatAccountPoints(session.account.quota)} 积分`}
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
            onJobChanged={generate.upsertJob}
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
            session={session}
            connections={connections}
            onConnectionsChange={setConnections}
            onLoggedOut={() => {
              setSession(null);
              setAuthRequired(true);
            }}
          />
        )}
      </main>
    </ProductSidebarLayout>
  );
}
