// src/features/settings/components/ExportDialog.tsx
// 导出对话框（TASK-SET-03，见 docs/product/16 §4.4）
//
// 打开即向主进程要一次 dryRun 统计，用来显示「预计包含 312 提示词 · 48 标签…」。
// 统计走的是**导出本身那段聚合代码**，所以这里的数字和最终文件里的必然一致。

import { useCallback, useEffect, useState } from 'react';
import { FileJson, FileArchive, Loader2, ShieldCheck } from '../../../components/ui/icons';
import type { ExportCounts, ExportMode, ExportResult } from '@musefold/desktop-contracts/ipc';
import { desktopHost as api } from '@renderer/runtime/desktop-host-services';
import { toast } from '../../../stores/toast';
import {
  Dialog,
  DialogBody,
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
}

const MODES: { value: ExportMode; icon: typeof FileJson; title: string; lines: string[] }[] = [
  {
    value: 'db-only',
    icon: FileJson,
    title: '仅数据（JSON）',
    lines: ['提示词 / 标签 / 文件夹 / 智能集合 / 服务商连接', '体积小，秒级完成。不含图片文件。'],
  },
  {
    value: 'db-with-images',
    icon: FileArchive,
    title: '数据 + 图片包（.zip）',
    lines: ['附带预览图与生成图。', '体积可能达 GB 级，导出耗时更长。'],
  },
];

/** counts → 「312 提示词 · 48 标签 · 6 文件夹」 */
function summarize(counts: ExportCounts | null): string {
  if (!counts) return '统计中…';
  const parts: string[] = [];
  const push = (n: number | undefined, label: string) => {
    if (n && n > 0) parts.push(`${n} ${label}`);
  };
  push(counts.prompts, '提示词');
  push(counts.tags, '标签');
  push(counts.folders, '文件夹');
  push(counts.smartSets, '智能集合');
  push(counts.providers, '服务商');
  push(counts.history, '历史');
  return parts.length > 0 ? parts.join(' · ') : '库是空的，将导出一个空信封';
}

export function ExportDialog({ open, onOpenChange }: Props) {
  const [mode, setMode] = useState<ExportMode>('db-only');
  const [includeHistory, setIncludeHistory] = useState(false);
  const [preview, setPreview] = useState<ExportResult | null>(null);
  const [busy, setBusy] = useState(false);

  // 预览随 includeHistory 变化重算 —— 勾了历史，数字就该跟着涨，
  // 否则用户看到的"预计包含"和实际产物对不上。
  const refresh = useCallback(() => {
    if (!api?.system) return;
    setPreview(null);
    api.system
      .export({ mode, includeHistory, dryRun: true })
      .then((r) => {
        if ('cancelled' in r) return;
        setPreview(r);
      })
      .catch(() => setPreview(null));
  }, [mode, includeHistory]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const counts = preview?.counts ?? null;

  const run = async () => {
    setBusy(true);
    try {
      const res = await api.system.export({ mode, includeHistory });
      if ('cancelled' in res) return; // 用户在系统保存对话框里点了取消
      const bits = [summarize(res.counts)];
      if (res.images != null) bits.push(`${res.images} 张图片`);
      toast.show({
        title: '导出完成',
        description: bits.join(' · '),
        variant: 'success',
        duration: 8000,
        action: { label: '打开位置', onClick: () => void api.system.openInFolder(res.path) },
      });
      if (res.redactedFields > 0) {
        // 用户把密钥粘进了提示词正文。导出时已打码，但得让他知道。
        toast.show({
          title: `已对 ${res.redactedFields} 处疑似密钥打码`,
          description: '提示词正文里检测到 API Key 形态的文本，导出文件中已替换为 ***。',
          variant: 'warning',
          duration: 10000,
        });
      }
      onOpenChange(false);
    } catch (err) {
      toast.error('导出失败', (err as Error)?.message ?? '未知错误');
    } finally {
      setBusy(false);
    }
  };

  // busy 期(Esc/遮罩/X)不可关,与 Backup/Danger/Import 同一关闭协议
  const changeOpen = (next: boolean) => {
    if (busy) return;
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-w-[480px]" hideClose={busy} data-testid="export-dialog">
        <DialogHeader>
          <DialogTitle>导出数据</DialogTitle>
          <DialogDescription>选择导出内容，随后会让你挑选保存位置。</DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-2">
          <ChoiceCards
            value={mode}
            onChange={setMode}
            testIdPrefix="export-mode"
            aria-label="导出内容"
            options={MODES.map((m) => ({
              value: m.value,
              title: m.title,
              icon: m.icon,
              description: m.lines.map((l) => (
                <span key={l} className="mt-0.5 block">
                  {l}
                </span>
              )),
            }))}
          />

          <SettingsCheckbox
            className="no-drag mt-1"
            checked={includeHistory}
            onCheckedChange={setIncludeHistory}
            label="包含生成历史"
            description="历史含每次生成的提示词快照与成本，默认不导出。"
            testId="export-include-history"
          />

          {/* 安全声明 —— 密钥永不出现在导出产物里（doc 16 §4.7 红线） */}
          <div className="mt-1 flex items-start gap-2.5 rounded-md border border-border-subtle bg-inset/40 px-3.5 py-2.5">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
            <p className="text-[11px] leading-relaxed text-tertiary">
              导出内容<span className="text-secondary">不包含任何 API 密钥</span>
              ；服务商仅保留名称 / base_url / 模型等元数据。
            </p>
          </div>

          <p
            className="px-1 text-[11px] leading-relaxed text-tertiary"
            data-testid="export-summary"
          >
            预计包含：{summarize(counts)}
          </p>
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => changeOpen(false)} disabled={busy}>
            取消
          </Button>
          <Button size="sm" onClick={run} disabled={busy} data-testid="export-confirm">
            {busy && <Loader2 className="h-3 w-3 animate-spin" />}
            {busy ? '导出中…' : '选择位置并导出'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
