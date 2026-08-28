import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  McpConnectionPage,
  WorkbenchSession,
  WorkbenchSessionPage,
} from '@musefold/contracts';
import type { ProductCapabilities } from '@musefold/domain';
import {
  Archive,
  Blocks,
  CheckCircle2,
  Database,
  Info,
  Loader2,
  RefreshCw,
  RotateCcw,
  Trash2,
} from '@musefold/legacy-ui/icons';
import { Button } from '@musefold/legacy-ui';
import { musefoldQueryKeys, SettingsCard, SettingsSection } from '@musefold/product-ui';
import type { WebGateway } from '../runtime';
import { ConnectionsView } from './ConnectionsView';

export function WebRelaySection({ capabilities }: { capabilities: Readonly<ProductCapabilities> }) {
  return (
    <SettingsSection
      title="中转站"
      description="Web 仅使用 Musefold Cloud 官方模型，不在浏览器保存或管理自备 API Key。"
    >
      <SettingsCard
        title="官方模型"
        description="模型目录、估价和费用边界由 Musefold Cloud 统一提供。"
        testId="web-settings-official-models"
      >
        <div className="flex items-start gap-3 px-4 py-4">
          <CheckCircle2 className="mt-0.5 text-accent" aria-hidden="true" />
          <div>
            <strong className="block text-[13px] text-primary">Musefold Cloud 官方生图</strong>
            <p className="mt-1 text-[12px] leading-relaxed text-secondary">
              每次生成都会在工作台展示模型、估价和确认状态，提交继续经过 GenerationGateway。
            </p>
          </div>
        </div>
      </SettingsCard>
      <SettingsCard
        title="Agent 与官方 Skills"
        description="Agent 只读取受限的账号、提示词、模型和官方 Skills 上下文。"
        testId="web-settings-agent"
      >
        <div className="flex items-start gap-3 px-4 py-4">
          <Blocks className="mt-0.5 text-accent" aria-hidden="true" />
          <div>
            <strong className="block text-[13px] text-primary">
              {capabilities.agent ? '官方 Agent 能力可用' : '官方 Agent 能力正在逐步开放'}
            </strong>
            <p className="mt-1 text-[12px] leading-relaxed text-secondary">
              Cloud Agent 不会写入提示词、执行生图、访问本地文件、读取凭据或访问任意 URL。
            </p>
          </div>
        </div>
      </SettingsCard>
    </SettingsSection>
  );
}

export function WebOpenSection({
  gateway,
  connections,
  connectionsLoading,
  connectionsError,
  cloudMcpAvailable,
  onConnectionsChange,
}: {
  gateway: WebGateway;
  connections: McpConnectionPage;
  connectionsLoading: boolean;
  connectionsError: string | null;
  cloudMcpAvailable: boolean;
  onConnectionsChange: (next: McpConnectionPage) => void;
}) {
  return (
    <SettingsSection
      title="开放能力"
      description="管理 Cloud MCP 的只读授权；本地 MCP、CLI 和自动化仅在 Desktop 提供。"
    >
      <SettingsCard
        title="Cloud MCP 授权"
        description="控制 AI 客户端访问 Musefold 账号、提示词和官方 Skills 的范围。"
        testId="web-settings-cloud-mcp"
      >
        {cloudMcpAvailable ? (
          <ConnectionsView
            gateway={gateway}
            connections={connections}
            onConnectionsChange={onConnectionsChange}
            loading={connectionsLoading}
            loadError={connectionsError}
            embedded
            showHeading={false}
          />
        ) : (
          <div className="flex items-start gap-3 px-4 py-5" role="status">
            <Info className="mt-0.5 text-secondary" aria-hidden="true" />
            <div>
              <strong className="block text-[13px] text-primary">Cloud MCP 当前不可用</strong>
              <p className="mt-1 text-[12px] leading-relaxed text-secondary">
                连接管理需要登录并保持网络连接；本地提示词和工作台不会因此被删除。
              </p>
            </div>
          </div>
        )}
      </SettingsCard>
    </SettingsSection>
  );
}

export function WebUnavailableSection({
  title,
  description,
  cardTitle,
  cardDescription,
  icon,
  testId,
}: {
  title: string;
  description: string;
  cardTitle: string;
  cardDescription: string;
  icon: ReactNode;
  testId: string;
}) {
  return (
    <SettingsSection title={title} description={description}>
      <SettingsCard title={cardTitle} description={cardDescription} testId={testId}>
        <div className="flex items-start gap-3 px-4 py-5" role="status">
          {icon}
          <p className="text-[12px] leading-relaxed text-secondary">
            此能力属于 Desktop 宿主范围，Web 不会模拟本地文件、系统密钥链或 Electron 控件。
          </p>
        </div>
      </SettingsCard>
    </SettingsSection>
  );
}

export function WebArchivedChatsSection({ gateway }: { gateway: WebGateway }) {
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkbenchSession | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const queryKey = musefoldQueryKeys.workbench.list({ limit: 100, includeArchived: true });
  const sessionsQuery = useQuery<WorkbenchSessionPage>({
    queryKey,
    queryFn: () => gateway.listWorkbenchSessions({ limit: 100, includeArchived: true }),
  });
  const archivedSessions = (sessionsQuery.data?.items ?? [])
    .filter((session) => session.archivedAt !== null && session.deletedAt === null)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const deleteMutation = useMutation({
    mutationFn: (session: WorkbenchSession) =>
      gateway.deleteWorkbenchSession(session.id, session.version),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: musefoldQueryKeys.workbench.all });
      setDeleteTarget(null);
    },
  });

  const restore = async (session: WorkbenchSession) => {
    setBusyId(session.id);
    setActionError(null);
    try {
      await gateway.updateWorkbenchSession(session.id, {
        expectedVersion: session.version,
        archived: false,
      });
      await queryClient.invalidateQueries({ queryKey: musefoldQueryKeys.workbench.all });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '恢复聊天失败，请稍后重试');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <SettingsSection
      title="已归档聊天"
      description="管理暂时收起的云端聊天；恢复后会回到工作台会话列表。"
    >
      <SettingsCard
        title="归档记录"
        description="恢复暂时收起的聊天，或删除不再需要的云端记录。"
        testId="web-settings-archived"
        action={
          <Button
            size="icon"
            variant="ghost"
            title="刷新归档聊天"
            aria-label="刷新归档聊天"
            onClick={() => void sessionsQuery.refetch()}
            disabled={sessionsQuery.isFetching}
          >
            {sessionsQuery.isFetching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        }
      >
        {actionError || deleteMutation.error ? (
          <p className="px-4 pt-4 text-[12px] text-danger" role="alert">
            {actionError ??
              (deleteMutation.error instanceof Error
                ? deleteMutation.error.message
                : '删除聊天失败，请稍后重试')}
          </p>
        ) : null}
        {sessionsQuery.isPending ? (
          <div
            className="flex min-h-32 items-center justify-center gap-2 px-4 text-[12px] text-secondary"
            role="status"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            正在读取归档聊天...
          </div>
        ) : sessionsQuery.error ? (
          <div className="px-4 py-5" role="alert">
            <p className="text-[13px] font-medium text-primary">归档聊天读取失败</p>
            <p className="mt-1 text-[12px] text-secondary">
              {sessionsQuery.error instanceof Error ? sessionsQuery.error.message : '请稍后重试'}
            </p>
          </div>
        ) : archivedSessions.length === 0 ? (
          <div
            className="flex min-h-32 flex-col items-center justify-center px-4 text-center"
            data-testid="web-settings-archived-empty"
          >
            <Archive className="h-5 w-5 text-quaternary" aria-hidden="true" />
            <p className="mt-3 text-[13px] font-medium text-primary">还没有已归档聊天</p>
          </div>
        ) : (
          <div data-testid="web-settings-archived-list">
            {archivedSessions.map((session) => {
              const busy = busyId === session.id || deleteMutation.isPending;
              return (
                <div
                  className="setting-item flex items-center gap-3 px-4 py-3"
                  key={session.id}
                  data-testid={`web-settings-archived-row-${session.id}`}
                >
                  <Archive className="h-4 w-4 shrink-0 text-secondary" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <strong className="block truncate text-[13px] font-medium text-primary">
                      {session.title}
                    </strong>
                    <span className="mt-0.5 block text-[11px] text-tertiary">
                      最近更新 {new Date(session.updatedAt).toLocaleString('zh-CN')}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void restore(session)}
                    data-testid={`web-settings-archived-restore-${session.id}`}
                  >
                    {busyId === session.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3.5 w-3.5" />
                    )}
                    恢复
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="删除聊天"
                    aria-label={`删除已归档聊天：${session.title}`}
                    disabled={busy}
                    onClick={() => {
                      setActionError(null);
                      setDeleteTarget(session);
                    }}
                    data-testid={`web-settings-archived-delete-${session.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </SettingsCard>
      {deleteTarget ? (
        <div
          className="mt-3 flex items-center justify-between gap-3 border border-solid border-subtle bg-inset px-4 py-3"
          role="alertdialog"
          aria-label="确认删除归档聊天"
        >
          <span className="min-w-0 text-[12px] text-secondary">
            删除“{deleteTarget.title}”？此操作会移除云端聊天记录。
          </span>
          <div className="flex shrink-0 gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDeleteTarget(null)}
              disabled={deleteMutation.isPending}
            >
              取消
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => void deleteMutation.mutateAsync(deleteTarget)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              删除
            </Button>
          </div>
        </div>
      ) : null}
    </SettingsSection>
  );
}

export function WebDataStatusCard() {
  return (
    <WebUnavailableSection
      title="数据存储"
      description="Web 使用 Musefold Cloud 保存账号内容，下载与上传遵循浏览器能力。"
      cardTitle="浏览器数据边界"
      cardDescription="Web 不提供 SQLite 路径、原生备份、应用日志或本机数据重置。"
      icon={<Database className="mt-0.5 text-secondary" aria-hidden="true" />}
      testId="web-settings-data"
    />
  );
}
