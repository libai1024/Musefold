'use client';

import {
  CLEAR_ALL_DATA_CONFIRMATION,
  type BackupInfo,
  type StorageLocation,
} from '@musefold/contracts';
import { useCapabilities } from '@musefold/platform';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@musefold/ui/components/alert-dialog';
import { Button } from '@musefold/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@musefold/ui/components/card';
import { Input } from '@musefold/ui/components/input';
import { Separator } from '@musefold/ui/components/separator';
import { Skeleton } from '@musefold/ui/components/skeleton';
import { toast } from '@musefold/ui/components/sonner';
import { Textarea } from '@musefold/ui/components/textarea';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  DatabaseBackup,
  FolderOpen,
  History,
  Library,
  ScrollText,
} from '@musefold/ui/icons';
import { cn } from '@musefold/ui/lib/utils';
import { useEffect, useState } from 'react';
import type { ScreenIntent } from '../shell/screen-intent-store';
import { useScreenIntent } from '../shell/screen-intent-store';
import { ArchivedSessionsPanel, formatArchivedAt } from './ArchivedSessionsPanel';
import {
  useBackups,
  useClearAllData,
  useCreateBackup,
  useDiagnosticLog,
  useOpenStorageLocation,
  useRelaunchApp,
  useRestoreBackup,
  useStorageLocations,
} from './hooks';

/**
 * 设置「数据」分区(07-settings-06):回收站入口 + 已归档对话(双端),
 * 加桌面专属四块 —— 数据库备份 / 存储位置 / 诊断日志 / 危险区,
 * 由 `capabilities.hasLocalDataManagement` 整体门控(Web 宿主整块不渲染,D2 无死入口)。
 *
 * 纪律:渲染层永不构造路径 —— 备份按文件名寻址、存储位置按白名单 id 打开;
 * 路径只作为 `displayPath` 展示与复制(桌面本机功能面),不进任何上行请求。
 */
export function DataStorageCard({
  onOpenScreen,
}: {
  onOpenScreen(id: 'prompts' | 'history'): void;
}) {
  const capabilities = useCapabilities();
  return (
    <div className="flex flex-col gap-6">
      <TrashCard onOpenScreen={onOpenScreen} />
      {capabilities.hasLocalDataManagement && (
        <>
          <BackupCard />
          <StorageCard />
          <DangerZoneCard />
        </>
      )}
    </div>
  );
}

function TrashRow({
  icon: Icon,
  label,
  testId,
  onClick,
}: {
  icon: typeof Library;
  label: string;
  testId: string;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-left text-sm transition-colors hover:bg-muted"
      data-testid={testId}
      onClick={onClick}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="flex-1 text-foreground">{label}</span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );
}

/** 回收站入口(经 screen-intent 跨屏直达 trash tab)+ 已归档对话列表:双端同形。 */
function TrashCard({ onOpenScreen }: { onOpenScreen(id: 'prompts' | 'history'): void }) {
  const setIntent = useScreenIntent((s) => s.setIntent);
  function open(intent: ScreenIntent, screen: 'prompts' | 'history') {
    setIntent(intent);
    onOpenScreen(screen);
  }
  return (
    <Card data-testid="settings-data-card">
      <CardHeader>
        <CardTitle>数据</CardTitle>
        <CardDescription>已删除的内容进入回收站;已归档对话可就地恢复或删除</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 pt-0">
        <TrashRow
          icon={Library}
          label="提示词回收站"
          testId="settings-open-prompt-trash"
          onClick={() => open({ kind: 'prompts-trash' }, 'prompts')}
        />
        <TrashRow
          icon={History}
          label="生成历史回收站"
          testId="settings-open-history-trash"
          onClick={() => open({ kind: 'history-trash' }, 'history')}
        />
        <Separator className="my-1" />
        <ArchivedSessionsPanel />
      </CardContent>
    </Card>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** 备份大小:KB 起步(数据库快照不会小于 1KB),整数不带小数点噪声。 */
export function formatBackupSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * 数据库备份卡(07-06 §2.2 / §5.2):
 * 状态行三态 → 立即备份(新备份直接展开可见)→ 列表逐份恢复(确认 + 重启语义)。
 * 恢复期间整卡 busy:不允许并行创建或另一份恢复。
 */
function BackupCard() {
  const backups = useBackups();
  const createBackup = useCreateBackup();
  const restoreBackup = useRestoreBackup();
  const relaunch = useRelaunchApp();
  const [expanded, setExpanded] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<BackupInfo | null>(null);

  const items = backups.data ?? [];
  const latest = items[0];
  const busy = createBackup.isPending || restoreBackup.isPending || relaunch.isPending;

  function statusText(): string {
    if (backups.isPending) return '正在读取备份…';
    if (backups.isError) return '备份状态不可用';
    if (items.length === 0) return '暂无备份';
    return `共 ${items.length} 份 · 最近备份 ${latest ? formatArchivedAt(latest.createdAt) : ''}`;
  }

  function create() {
    createBackup.mutate(undefined, {
      onSuccess: () => {
        // 就近反馈:新备份不该藏在收起的列表里(承 v2.1 已打磨细节)。
        setExpanded(true);
        toast.success('当前数据库已保存为一致性快照');
      },
    });
  }

  function confirmRestore() {
    if (!restoreTarget) return;
    restoreBackup.mutate(restoreTarget.file, {
      onSuccess: () => {
        setRestoreTarget(null);
        toast.success('备份已恢复,应用即将重启');
        relaunch.mutate();
      },
    });
  }

  return (
    <Card data-testid="settings-backup-card" aria-busy={busy}>
      <CardHeader>
        <CardTitle>数据库备份</CardTitle>
        <CardDescription>
          备份是数据库的一致性快照,只保留最近 10 份;恢复会覆盖当前数据并重启应用
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        <div className="flex items-center gap-2">
          <DatabaseBackup className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p
            className="min-w-0 flex-1 text-muted-foreground text-sm tabular-nums"
            data-testid="settings-backup-status"
          >
            {statusText()}
          </p>
          {items.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 shrink-0 text-xs"
              aria-expanded={expanded}
              data-testid="settings-backup-toggle"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? '收起' : '查看备份'}
              <ChevronDown
                className={cn(
                  'size-3.5 transition-transform duration-(--dur-fast)',
                  expanded && 'rotate-180',
                )}
                aria-hidden
              />
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-8 shrink-0"
            disabled={busy}
            data-testid="settings-backup-create"
            onClick={create}
          >
            {createBackup.isPending ? '备份中…' : '立即备份'}
          </Button>
        </div>

        {backups.isError && (
          <p className="text-destructive text-xs" data-testid="settings-backup-error">
            备份读取失败:{errorMessage(backups.error, '未知原因')}
          </p>
        )}
        {createBackup.isError && (
          <p className="text-destructive text-xs" data-testid="settings-backup-create-error">
            创建备份失败:{errorMessage(createBackup.error, '未知原因')}
          </p>
        )}
        {restoreBackup.isError && (
          <p className="text-destructive text-xs" data-testid="settings-backup-restore-error">
            恢复备份失败:{errorMessage(restoreBackup.error, '未知原因')}
          </p>
        )}

        {expanded && items.length > 0 && (
          <ul
            className="flex flex-col gap-0.5"
            aria-label="备份列表"
            data-testid="settings-backup-list"
          >
            {items.map((backup) => (
              <li
                key={backup.file}
                className="flex items-center gap-2 rounded-md px-1 py-1.5"
                data-testid={`settings-backup-row-${backup.file}`}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-foreground text-xs tabular-nums">
                  {backup.file}
                </span>
                <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                  {formatBackupSize(backup.size)} · {formatArchivedAt(backup.createdAt)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 text-xs"
                  disabled={busy}
                  data-testid={`settings-backup-restore-${backup.file}`}
                  onClick={() => setRestoreTarget(backup)}
                >
                  恢复
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <AlertDialog
        open={restoreTarget !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setRestoreTarget(null);
        }}
      >
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>恢复此备份?</AlertDialogTitle>
            <AlertDialogDescription>
              当前数据将被该备份覆盖,应用将重启。恢复前会自动保存一份当前数据的快照。
              {restoreTarget ? `备份时间:${formatArchivedAt(restoreTarget.createdAt)}` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              data-testid="settings-backup-restore-confirm"
              disabled={busy}
              onClick={(event) => {
                // 失败要留在对话框里就地报错,不能被默认关闭吃掉。
                event.preventDefault();
                confirmRestore();
              }}
            >
              {restoreBackup.isPending ? '恢复中…' : '恢复并重启'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/** 复制按钮:钮内 Check 1.2s + toast(0706-C2 / 0704-C2 同一封装)。 */
function CopyButton({
  text,
  label,
  testId,
  toastMessage,
}: {
  text: string;
  label: string;
  testId: string;
  toastMessage: string;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1_200);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 shrink-0 gap-1 text-muted-foreground text-xs hover:text-foreground"
      aria-label={label}
      title={label}
      data-testid={testId}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true);
            toast.success(toastMessage);
          },
          () => toast.error('复制失败,请手动选中复制'),
        );
      }}
    >
      {copied ? (
        <Check className="size-3.5 text-success" aria-hidden />
      ) : (
        <Copy className="size-3.5" aria-hidden />
      )}
      {label}
    </Button>
  );
}

/** 存储位置 + 诊断日志(07-06 §2.3):路径行 mono,失败就地红字而不只 toast。 */
function StorageCard() {
  const locations = useStorageLocations();
  const openLocation = useOpenStorageLocation();
  const [logOpen, setLogOpen] = useState(false);
  const log = useDiagnosticLog(logOpen);

  const items: StorageLocation[] = locations.data ?? [];

  return (
    <Card data-testid="settings-storage-card">
      <CardHeader>
        <CardTitle>存储位置</CardTitle>
        <CardDescription>数据全部保存在本机;备份与图片可直接在文件管理器中打开</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        {locations.isPending && (
          <div className="flex flex-col gap-2" data-testid="settings-storage-loading">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-9 w-full rounded-md" />
            ))}
          </div>
        )}
        {locations.isError && (
          <p className="text-destructive text-xs" data-testid="settings-storage-error">
            路径读取失败:{errorMessage(locations.error, '未知原因')}
          </p>
        )}
        {items.length > 0 && (
          <ul className="flex flex-col gap-1" aria-label="存储位置列表">
            {items.map((location) => (
              <li
                key={location.id}
                className="flex flex-wrap items-center gap-x-2 gap-y-1"
                data-testid={`settings-storage-row-${location.id}`}
              >
                <span className="w-20 shrink-0 text-foreground text-sm">{location.label}</span>
                <span
                  className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-xs"
                  title={location.displayPath}
                  data-testid={`settings-storage-path-${location.id}`}
                >
                  {location.displayPath}
                </span>
                <CopyButton
                  text={location.displayPath}
                  label="复制路径"
                  testId={`settings-storage-copy-${location.id}`}
                  toastMessage="路径已复制"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 gap-1 text-muted-foreground text-xs hover:text-foreground"
                  data-testid={`settings-storage-open-${location.id}`}
                  disabled={openLocation.isPending}
                  onClick={() => openLocation.mutate(location.id)}
                >
                  <FolderOpen className="size-3.5" aria-hidden />
                  打开
                </Button>
              </li>
            ))}
          </ul>
        )}
        {openLocation.isError && (
          <p className="text-destructive text-xs" data-testid="settings-storage-open-error">
            打开位置失败:{errorMessage(openLocation.error, '未知原因')}
          </p>
        )}

        <Separator />

        <div className="flex items-center gap-2">
          <ScrollText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="min-w-0 flex-1 text-foreground text-sm">诊断日志</p>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 text-xs"
            aria-expanded={logOpen}
            data-testid="settings-log-toggle"
            onClick={() => setLogOpen((value) => !value)}
          >
            {logOpen ? '收起' : '查看'}
          </Button>
        </div>
        {logOpen && (
          <div className="flex flex-col gap-1" data-testid="settings-log-body">
            {log.isPending && <p className="text-muted-foreground text-xs">读取中…</p>}
            {log.isError && (
              <p className="text-destructive text-xs" data-testid="settings-log-error">
                (读取日志失败)
              </p>
            )}
            {log.isSuccess && log.data.text.trim().length === 0 && (
              <p className="text-muted-foreground text-xs" data-testid="settings-log-empty">
                (暂无日志)
              </p>
            )}
            {log.isSuccess && log.data.text.trim().length > 0 && (
              <>
                <Textarea
                  readOnly
                  rows={10}
                  value={log.data.text}
                  aria-label="诊断日志内容"
                  className="max-h-64 resize-none font-mono text-xs"
                  data-testid="settings-log-text"
                />
                {log.data.truncated && (
                  <p className="text-muted-foreground text-xs">
                    较早的日志已省略,完整文件在「诊断日志」目录中
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * 危险区(07-06 §2.4):确认短语精确匹配才可执行(比 AlertDialog 更强的摩擦,I3 顶格形态)。
 * 输入框 mono + placeholder 显示目标短语,允许粘贴;匹配后执行钮由 outline 转 destructive 填充。
 */
function DangerZoneCard() {
  const clearAllData = useClearAllData();
  const [confirmation, setConfirmation] = useState('');
  const [clearedBackupFile, setClearedBackupFile] = useState<string | null>(null);
  const matched = confirmation.trim() === CLEAR_ALL_DATA_CONFIRMATION;

  function clear() {
    clearAllData.mutate(undefined, {
      onSuccess: (result) => {
        setConfirmation('');
        setClearedBackupFile(result.safetyBackupFile);
        toast.success('数据已清空 · Provider、API 密钥和图片文件保持不变');
      },
    });
  }

  return (
    <Card className="border-destructive/30" data-testid="settings-danger-card">
      <CardHeader>
        <CardTitle className="text-destructive">危险区</CardTitle>
        <CardDescription>
          清空全部数据——提示词、组合内容和生成历史将被永久清空。Provider、API
          密钥和已生成的图片文件保持不变;清空前会自动创建一份备份
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 pt-0">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={confirmation}
            placeholder={CLEAR_ALL_DATA_CONFIRMATION}
            aria-label={`输入「${CLEAR_ALL_DATA_CONFIRMATION}」以确认`}
            className="h-8 min-w-40 flex-1 font-mono text-sm"
            data-testid="settings-danger-confirm-input"
            disabled={clearAllData.isPending}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          <Button
            variant={matched ? 'destructive' : 'outline'}
            size="sm"
            className="h-8 shrink-0"
            disabled={!matched || clearAllData.isPending}
            data-testid="settings-danger-clear"
            onClick={clear}
          >
            {clearAllData.isPending ? '清空中…' : '清空全部数据'}
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          输入上方短语「{CLEAR_ALL_DATA_CONFIRMATION}」后按钮才会解锁,可直接粘贴
        </p>
        {clearAllData.isError && (
          <p className="text-destructive text-xs" data-testid="settings-danger-error">
            清空数据失败:{errorMessage(clearAllData.error, '未知原因')}
          </p>
        )}
        {clearedBackupFile && (
          <p
            className="font-mono text-muted-foreground text-xs"
            data-testid="settings-danger-backup"
          >
            清空前快照:{clearedBackupFile}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
