// src/features/library/components/PromptEditor.tsx
// 提示词编辑器 —— 新建/编辑
//
// v0.3.2 提示词重塑：编辑器只保留「标题 + 正文」，负面提示词折叠为可选。
// 文件夹/模型/评分/标签等组织字段从 UI 退役（数据保留，保存时不触碰）。
//   - 字段级校验 + 保存禁用 + 红字提示
//   - 脏检查：有未保存改动时关闭要二次确认
//   - 写操作走 store（统一错误处理 + 列表同步）

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Prompt } from '@shared/types/models';
import { AlertCircle, ChevronDown } from '../../../components/ui/icons';
import { useLibraryStore } from '../store';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Textarea } from '../../../components/ui/textarea';
import { cn } from '../../../lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prompt?: Prompt | null;
  onSaved?: (p: Prompt) => void;
}

interface FormState {
  title: string;
  content: string;
  contentNegative: string;
}

const MAX_TITLE = 120;

function toForm(p?: Prompt | null): FormState {
  return {
    title: p?.title ?? '',
    content: p?.content ?? '',
    contentNegative: p?.contentNegative ?? '',
  };
}

export function PromptEditor({ open, onOpenChange, prompt, onSaved }: Props) {
  const createPrompt = useLibraryStore((s) => s.createPrompt);
  const updatePrompt = useLibraryStore((s) => s.updatePrompt);

  const [form, setForm] = useState<FormState>(() => toForm(prompt));
  const initialRef = useRef<FormState>(form);
  const [touched, setTouched] = useState<{ title?: boolean; content?: boolean }>({});
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [negativeOpen, setNegativeOpen] = useState(false);

  // 打开/切换目标时重置表单与脏基线
  useEffect(() => {
    if (!open) return;
    const next = toForm(prompt);
    setForm(next);
    initialRef.current = next;
    setTouched({});
    setConfirmDiscard(false);
    setSaveError(null);
    setNegativeOpen(Boolean(next.contentNegative));
  }, [open, prompt]);

  const patch = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const errors = useMemo(() => {
    const e: { title?: string; content?: string } = {};
    if (!form.title.trim()) e.title = '标题必填';
    else if (form.title.length > MAX_TITLE) e.title = `标题不超过 ${MAX_TITLE} 字`;
    if (!form.content.trim()) e.content = '正文必填';
    return e;
  }, [form.title, form.content]);

  const valid = Object.keys(errors).length === 0;
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initialRef.current), [form]);

  const close = () => {
    if (dirty && !confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    onOpenChange(false);
  };

  const handleSave = async () => {
    setTouched({ title: true, content: true });
    if (!valid || saving) return;
    setSaving(true);
    setSaveError(null);

    const saved = prompt
      ? await updatePrompt(prompt.id, {
          title: form.title.trim(),
          content: form.content,
          contentNegative: form.contentNegative.trim() || null,
          // 誊清（v0.3.3 §8）：笺补全保存后翻转为正式提示词，离开笺匣
          ...(prompt.source === 'slip' ? { source: 'manual' as const } : {}),
        })
      : await createPrompt({
          title: form.title.trim(),
          content: form.content,
          contentNegative: form.contentNegative.trim() || undefined,
        });

    setSaving(false);
    if (!saved) {
      // 失败：保留表单内容，顶部给错误条
      setSaveError('保存失败，请重试。改动仍保留在表单里。');
      return;
    }
    initialRef.current = form;
    onSaved?.(saved);
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
        else onOpenChange(true);
      }}
    >
      <DialogContent
        className="max-w-xl"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 's') {
            e.preventDefault();
            void handleSave();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{prompt?.source === 'slip' ? '誊清这枚笺' : prompt ? '编辑提示词' : '新建提示词'}</DialogTitle>
          <DialogDescription>
            {prompt?.source === 'slip' ? '补全后保存，笺将誊入正式提示词库。⌘S 保存。' : '标题与正文必填。⌘S 保存。'}
          </DialogDescription>
        </DialogHeader>

        {saveError && (
          <div
            role="alert"
            data-testid="editor-error"
            className="flex items-start gap-1.5 rounded-md border border-danger/30 bg-danger/10 px-2.5 py-2 text-[11px] text-danger"
          >
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            {saveError}
          </div>
        )}

        <div className="flex max-h-[62vh] flex-col gap-3 overflow-y-auto pr-1">
          <Field label="标题" required error={touched.title ? errors.title : undefined}>
            <Input
              autoFocus
              value={form.title}
              onChange={(e) => patch('title', e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, title: true }))}
              placeholder="给这段提示词起一个能认出来的名字"
              maxLength={MAX_TITLE + 20}
              aria-invalid={Boolean(touched.title && errors.title)}
              data-testid="editor-title"
            />
          </Field>

          <Field label="正文" required error={touched.content ? errors.content : undefined}>
            <Textarea
              value={form.content}
              onChange={(e) => patch('content', e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, content: true }))}
              placeholder="生成图像时实际发送的提示词内容"
              rows={8}
              className="font-mono text-[12px] leading-relaxed"
              aria-invalid={Boolean(touched.content && errors.content)}
              data-testid="editor-content"
            />
          </Field>

          <div>
            <button
              type="button"
              onClick={() => setNegativeOpen((v) => !v)}
              className="flex min-h-7 items-center gap-1 text-[11px] font-medium text-secondary transition-colors hover:text-primary"
              aria-expanded={negativeOpen}
              data-testid="editor-negative-toggle"
            >
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', !negativeOpen && '-rotate-90')} />
              负面提示词
              <span className="font-normal text-quaternary">可选</span>
            </button>
            {negativeOpen && (
              <Textarea
                value={form.contentNegative}
                onChange={(e) => patch('contentNegative', e.target.value)}
                placeholder="不希望出现的元素"
                rows={3}
                className="mt-1.5 font-mono text-[12px] leading-relaxed"
                data-testid="editor-negative"
              />
            )}
          </div>
        </div>

        {confirmDiscard ? (
          <div className="flex items-center justify-between gap-2 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2">
            <span className="text-[11px] text-warning">有未保存的改动，确认放弃？</span>
            <div className="flex gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => setConfirmDiscard(false)}>
                继续编辑
              </Button>
              <Button size="sm" variant="outline" onClick={() => onOpenChange(false)} data-testid="editor-discard">
                放弃改动
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              取消
            </Button>
            <Button disabled={saving || !valid} onClick={() => void handleSave()} data-testid="editor-save">
              {saving ? '保存中…' : '保存'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline gap-1.5">
        <label className="text-[11px] font-medium text-secondary">{label}</label>
        {required && <span className="text-[10px] text-quaternary">必填</span>}
        {error && (
          <span className="ml-auto text-[10px] text-danger" role="alert">
            {error}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
