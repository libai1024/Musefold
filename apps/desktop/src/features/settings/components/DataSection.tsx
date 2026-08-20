// src/features/settings/components/DataSection.tsx
// 数据与存储 —— 导出/导入 + 备份 + 存储路径 + 诊断日志（版本信息在「关于」）
import { useEffect, useState } from 'react';
import {
  FolderOpen,
  RefreshCw,
  Download,
  Upload,
} from '../../../components/ui/icons';
import { desktopHost as api } from '@renderer/runtime/desktop-host-services';
import { SectionShell } from '../components/SectionShell';
import { Button } from '../../../components/ui/button';
import { ExportDialog } from '../components/ExportDialog';
import { ImportDialog } from '../components/ImportDialog';
import { BackupPanel } from '../components/BackupPanel';
import { DangerZonePanel } from '../components/DangerZonePanel';
import { useLibraryStore } from '../../library/store';
import { useHistoryStore } from '../../history/store';
import { useGenerationWorkbenchStore } from '../../generation/workbench/store';

interface Paths {
  userData: string;
  pictures: string;
  backups: string;
  logs: string;
}

export function DataSection() {
  const [paths, setPaths] = useState<Paths | null>(null);
  const [logText, setLogText] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [backupRefreshKey, setBackupRefreshKey] = useState(0);

  useEffect(() => {
    // 防御：preload 桥缺失时（如纯前端预览）优雅降级，避免整页崩溃
    if (!api?.system) return;
    api.system.getPaths().then(setPaths).catch(() => {});
  }, []);

  const refreshLog = () => {
    if (!api?.log) return;
    api.log.tail(300).then((t) => setLogText(t || '（暂无日志）')).catch(() => setLogText('（读取日志失败）'));
  };

  const toggleLog = () => {
    const next = !logOpen;
    setLogOpen(next);
    if (next && logText === null) refreshLog();
  };

  // 诊断日志不在此列：下方有带「查看/打开」的专属行，避免同名双行
  const rows: { label: string; path?: string }[] = [
    { label: '图片输出', path: paths?.pictures },
    { label: '应用数据', path: paths?.userData },
    { label: '备份目录', path: paths?.backups },
  ];

  // 导入会整批改库，各视图的 store 都得重读，否则用户切回资源库还是旧列表
  const afterImport = () => {
    void useLibraryStore.getState().loadAll();
    void useHistoryStore.getState().load();
    useGenerationWorkbenchStore.getState().newSession();
    setBackupRefreshKey((value) => value + 1);
  };

  const afterReset = async () => {
    useLibraryStore.setState({
      selectedPromptId: null,
      search: '',
      filters: {},
      searchHistory: [],
      deleted: [],
      trashOpen: false,
    });
    useHistoryStore.setState({ records: [], selectedId: null, retryingIds: new Set(), error: null });
    useGenerationWorkbenchStore.getState().newSession();
    await Promise.all([
      useLibraryStore.getState().loadAll(),
      useHistoryStore.getState().load(),
    ]);
    setBackupRefreshKey((value) => value + 1);
  };

  return (
    <SectionShell
      title="数据与存储"
      description="生成的图片与数据库存放在本机。密钥单独经系统密钥库加密，不在这些目录内以明文存在。"
    >
      {/* 与其他分区一致的连续细线列表：无前置图标、统一行节奏（v0.3.x 设置一致性） */}
      <div className="settings-list flex flex-col">
        {/* 导出与导入 —— 备份迁移闭环（TASK-SET-03） */}
        <div className="settings-row flex items-center gap-6 border-b border-border-subtle py-[var(--density-setting-row-y)] first:border-t">
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-medium text-primary">导出与导入</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-tertiary">
              备份或迁移全部数据。导出内容不含任何 API 密钥。
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button size="sm" variant="outline" onClick={() => setExportOpen(true)} data-testid="open-export">
              <Download className="h-3 w-3" /> 导出
            </Button>
            <Button size="sm" variant="outline" onClick={() => setImportOpen(true)} data-testid="open-import">
              <Upload className="h-3 w-3" /> 导入
            </Button>
          </div>
        </div>

        <BackupPanel refreshKey={backupRefreshKey} />

        {rows.map((r) => (
          <div
            key={r.label}
            className="settings-row flex items-center gap-6 border-b border-border-subtle py-[var(--density-setting-row-y)]"
          >
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-medium text-primary">{r.label}</p>
              <p className="mt-0.5 truncate font-mono text-[11px] text-tertiary">{r.path ?? '未读取'}</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={!r.path}
              onClick={() => r.path && api.system.openInFolder(r.path)}
            >
              <FolderOpen className="h-3 w-3" /> 打开
            </Button>
          </div>
        ))}

        {/* 诊断日志 —— 排查生图/连接异常。日志已脱敏，绝不含 API Key */}
        <div className="border-b border-border-subtle">
          <div className="settings-row flex items-center gap-6 py-[var(--density-setting-row-y)]">
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-medium text-primary">诊断日志</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-tertiary">
                记录生图与连接过程，便于排查异常。已脱敏，不含 API Key。
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button size="sm" variant="outline" onClick={toggleLog}>
                {logOpen ? '收起' : '查看'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => api?.log?.openDir()}>
                <FolderOpen className="h-3 w-3" /> 打开
              </Button>
            </div>
          </div>
          {logOpen && (
            <div className="mb-4 overflow-hidden rounded-lg border border-border-subtle">
              <div className="flex items-center justify-between px-3.5 py-1.5">
                <span className="text-[10px] uppercase tracking-wide text-quaternary">最近 300 行</span>
                <button
                  onClick={refreshLog}
                  className="no-drag flex items-center gap-1 text-[10px] text-tertiary hover:text-secondary"
                >
                  <RefreshCw className="h-3 w-3" /> 刷新
                </button>
              </div>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all border-t border-border-subtle bg-inset/40 px-3.5 py-2.5 font-mono text-[10px] leading-relaxed text-secondary">
                {logText ?? '加载中…'}
              </pre>
            </div>
          )}
        </div>

        <DangerZonePanel onExport={() => setExportOpen(true)} onReset={afterReset} />
      </div>

      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={afterImport} />
    </SectionShell>
  );
}
