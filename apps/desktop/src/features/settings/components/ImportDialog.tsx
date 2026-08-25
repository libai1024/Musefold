// src/features/settings/components/ImportDialog.tsx
// 导入对话框（TASK-SET-03，见 docs/product/16 §4.5）
//
// 两段式：
//   ① 选文件 → 主进程 dryRun（事务内跑完再回滚）→ 拿到**真实**计数与文件头
//   ② 用户挑策略 → 用 ① 回传的 sourcePath 真跑，不再二次弹框
//
// 预览与真跑共用同一段写入代码，所以不会出现"预览说导 312 条、实跑只有 300 条"。
// 换策略会重新 dryRun —— 三种策略的计数本来就不同，不重算就是在骗人。

import { useEffect, useState } from 'react';
import { AlertTriangle, FileUp, Loader2 } from '../../../components/ui/icons';
import type { ImportResult, ImportStrategy } from '@musefold/desktop-contracts/ipc';
import { desktopHost as api } from '@renderer/runtime/desktop-host-services';
import { toast } from '../../../stores/toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { SettingsCheckbox } from '@musefold/product-ui';
import { ChoiceCards } from './ChoiceCards';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 导入成功后让各 store 重读数据 */
  onImported?: () => void;
}

const STRATEGIES: {
  value: ImportStrategy;
  title: string;
  detail: string;
  danger?: boolean;
}[] = [
  {
    value: 'merge',
    title: '合并',
    detail: '保留双方；同 id 冲突时按更新时间取新的那份。',
  },
  {
    value: 'skip',
    title: '跳过',
    detail: '只导入本地不存在的条目，已存在的一律不动。',
  },
  {
    value: 'replace',
    title: '替换',
    detail: '先清空同类数据再全量导入。不可逆，会自动先备份。',
    danger: true,
  },
];

const fileName = (p: string): string => p.split(/[\\/]/).pop() ?? p;

function fmtTime(ts: number): string {
  if (!ts) return '未知时间';
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

/** 逐类统计 → 「312 提示词 · 48 标签」 */
function summarize(counts: Record<string, number | undefined>): string {
  const labels: [string, string][] = [
    ['prompts', '提示词'],
    ['tags', '标签'],
    ['folders', '文件夹'],
    ['fragments', '片段'],
    ['templates', '模板'],
    ['compositions', '组合'],
    ['versionSnapshots', '版本快照'],
    ['versionEvents', '版本事件'],
    ['smartSets', '智能集合'],
    ['providers', '服务商'],
    ['history', '历史'],
  ];
  const parts = labels
    .filter(([k]) => (counts[k] ?? 0) > 0)
    .map(([k, label]) => `${counts[k]} ${label}`);
  return parts.length > 0 ? parts.join(' · ') : '无内容';
}

export function ImportDialog({ open, onOpenChange, onImported }: Props) {
  const [strategy, setStrategy] = useState<ImportStrategy>('merge');
  const [autoBackup, setAutoBackup] = useState(true);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 关闭时清干净，避免下次打开还挂着上次的文件与结果
  useEffect(() => {
    if (!open) {
      setPreview(null);
      setDone(null);
      setError(null);
      setBusy(false);
      setStrategy('merge');
      setAutoBackup(true);
    }
  }, [open]);

  /** ① 选文件并预览。sourcePath 为空 → 主进程弹打开对话框 */
  const pick = async (sourcePath?: string, nextStrategy = strategy) => {
    if (!api?.system) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.system.import({ sourcePath, strategy: nextStrategy, dryRun: true });
      if ('cancelled' in res) {
        // 用户在系统打开对话框里点了取消；没选过文件就整个关掉
        if (!preview) onOpenChange(false);
        return;
      }
      setPreview(res);
    } catch (err) {
      // 校验失败（选错文件 / 版本过新 / JSON 损坏）都走到这
      setPreview(null);
      setError((err as Error)?.message ?? '无法读取该文件');
    } finally {
      setBusy(false);
    }
  };

  // 打开即弹文件选择。**只依赖 open** —— 把 pick 加进依赖数组会因为它每次
  // 渲染都是新函数而反复弹系统对话框。
  useEffect(() => {
    if (open && !preview && !busy && !error && !done) void pick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** 换策略：重新 dryRun，因为三种策略的计数不同 */
  const changeStrategy = (next: ImportStrategy) => {
    setStrategy(next);
    if (preview) void pick(preview.sourcePath, next);
  };

  /** ② 真跑 */
  const run = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.system.import({
        sourcePath: preview.sourcePath,
        strategy,
        autoBackup,
      });
      if ('cancelled' in res) return;
      setDone(res);
      onImported?.();
      toast.show({
        title: '导入完成',
        description: `新增 ${res.imported} · 覆盖 ${res.updated} · 跳过 ${res.skipped}${
          res.failed > 0 ? ` · 失败 ${res.failed}` : ''
        }`,
        variant: res.failed > 0 ? 'warning' : 'success',
        duration: 8000,
      });
    } catch (err) {
      setError((err as Error)?.message ?? '导入失败');
    } finally {
      setBusy(false);
    }
  };

  const src = preview?.source;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[500px]" data-testid="import-dialog">
        <DialogHeader>
          <DialogTitle>导入数据</DialogTitle>
          <DialogDescription>从 Musefold 导出文件（.json / .zip）恢复数据。</DialogDescription>
        </DialogHeader>

        {/* ── 结果态 ── */}
        {done ? (
          <div className="flex flex-col gap-2" data-testid="import-done">
            <div className="rounded-md border border-border-subtle bg-elevated px-3.5 py-3">
              <p className="text-[12px] font-medium text-primary">
                新增 {done.imported} · 覆盖 {done.updated} · 跳过 {done.skipped}
                {done.failed > 0 && ` · 失败 ${done.failed}`}
              </p>
              <div className="mt-2 flex flex-col gap-1">
                {Object.entries(done.byType)
                  .filter(([, s]) => s.imported + s.updated + s.skipped + s.failed > 0)
                  .map(([type, s]) => (
                    <p key={type} className="font-mono text-meta text-tertiary">
                      {type}: +{s.imported} ~{s.updated} ={s.skipped}
                      {s.failed > 0 && ` ✕${s.failed}`}
                    </p>
                  ))}
              </div>
            </div>
            {done.backupPath && (
              <p className="px-1 text-[11px] text-tertiary">
                已备份至 <span className="font-mono">{fileName(done.backupPath)}</span>
              </p>
            )}
            {done.warnings.length > 0 && (
              <div
                className="rounded-md border border-warning/30 bg-warning/10 px-3.5 py-2.5"
                data-testid="import-warnings"
              >
                <p className="text-[11px] font-medium text-primary">
                  {done.warnings.length} 条提醒
                </p>
                <ul className="mt-1 flex max-h-32 flex-col gap-0.5 overflow-auto">
                  {done.warnings.map((w, i) => (
                    <li key={i} className="text-meta leading-relaxed text-tertiary">
                      · {w}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : error ? (
          /* ── 错误态 ── */
          <div className="flex flex-col gap-2.5" data-testid="import-error">
            <div className="flex items-start gap-2.5 rounded-md border border-danger/30 bg-danger/10 px-3.5 py-3">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
              <p className="text-[11px] leading-relaxed text-secondary">{error}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => void pick()} className="self-start">
              <FileUp className="h-3 w-3" /> 重新选择文件
            </Button>
          </div>
        ) : !preview ? (
          /* ── 选文件中 ── */
          <div className="flex items-center gap-2 px-1 py-6 text-[12px] text-tertiary">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            等待选择文件…
          </div>
        ) : (
          /* ── 策略选择态 ── */
          <div className="flex flex-col gap-2">
            <div
              className="rounded-md border border-border-subtle bg-inset/40 px-3.5 py-2.5"
              data-testid="import-source"
            >
              <p className="truncate font-mono text-[11px] text-secondary">
                {fileName(preview.sourcePath)}
              </p>
              <p className="mt-0.5 text-meta text-tertiary">
                格式 v{src?.schemaVersion} · 由 Musefold {src?.appVersion} 于{' '}
                {fmtTime(src?.exportedAt ?? 0)} 导出
              </p>
              <p className="mt-1 text-[11px] text-tertiary">
                文件含：{summarize((src?.counts ?? {}) as Record<string, number | undefined>)}
              </p>
            </div>

            <p className="mt-0.5 px-1 text-[11px] font-medium text-secondary">遇到 id 冲突时：</p>
            <ChoiceCards
              value={strategy}
              onChange={changeStrategy}
              testIdPrefix="import-strategy"
              aria-label="id 冲突处理策略"
              options={STRATEGIES.map((s) => ({
                value: s.value,
                title: s.title,
                description: s.detail,
                danger: s.danger,
                titleExtra: s.danger ? (
                  <AlertTriangle className="h-3 w-3 text-warning" aria-hidden="true" />
                ) : undefined,
              }))}
            />

            {/* 预览计数：真实事务跑出来的，不是拍脑袋估的 */}
            <p className="px-1 text-[11px] text-tertiary" data-testid="import-preview">
              按此策略将：新增 {preview.imported} · 覆盖 {preview.updated} · 跳过 {preview.skipped}
              {preview.failed > 0 && ` · 失败 ${preview.failed}`}
            </p>

            <SettingsCheckbox
              className="no-drag mt-1"
              checked={strategy === 'replace' ? true : autoBackup}
              // 替换策略强制备份，不给关（doc 16 验收标准）
              disabled={strategy === 'replace'}
              onCheckedChange={setAutoBackup}
              label={
                <>
                  导入前自动备份当前数据库
                  {strategy === 'replace' && (
                    <span className="text-warning">（替换策略下强制开启）</span>
                  )}
                </>
              }
              testId="import-auto-backup"
            />

            {strategy === 'replace' && (
              <div
                className="flex items-start gap-2.5 rounded-md border border-danger/30 bg-danger/10 px-3.5 py-2.5"
                data-testid="import-replace-warning"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
                <p className="text-[11px] leading-relaxed text-secondary">
                  「替换」不可逆，将删除现有的提示词、标签、片段、模板、组合与历史。
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            {done ? '完成' : '取消'}
          </Button>
          {!done && (
            <Button
              size="sm"
              variant={strategy === 'replace' ? 'danger' : 'primary'}
              onClick={run}
              disabled={busy || !preview}
              data-testid="import-confirm"
            >
              {busy && <Loader2 className="h-3 w-3 animate-spin" />}
              {busy ? '导入中…' : strategy === 'replace' ? '替换并导入' : '开始导入'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
