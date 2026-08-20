// Desktop prompt editing host. The form itself is shared with Web so field,
// validation, keyboard and discard interactions cannot drift between hosts.

import { useMemo, useState } from 'react';
import type { Prompt } from '@musefold/desktop-contracts/models';
import {
  PromptEditorForm,
  type PromptEditorDraft,
} from '@musefold/product-ui';
import { useLibraryStore } from '../store';
import { Dialog, DialogContent } from '../../../components/ui/dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prompt?: Prompt | null;
  onSaved?: (prompt: Prompt) => void;
}

function toDraft(prompt?: Prompt | null): PromptEditorDraft {
  return {
    title: prompt?.title ?? '',
    description: prompt?.description ?? '',
    content: prompt?.content ?? '',
    negative: prompt?.contentNegative ?? '',
    isPinned: prompt?.isPinned ?? false,
  };
}

export function PromptEditor({
  open,
  onOpenChange,
  prompt,
  onSaved,
}: Props) {
  const createPrompt = useLibraryStore((state) => state.createPrompt);
  const updatePrompt = useLibraryStore((state) => state.updatePrompt);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const initial = useMemo(() => toDraft(prompt), [prompt]);
  const isSlip = prompt?.source === 'slip';

  const submit = async (draft: PromptEditorDraft) => {
    setSaving(true);
    setSaveError(null);
    const saved = prompt
      ? await updatePrompt(prompt.id, {
          title: draft.title,
          description: draft.description || null,
          content: draft.content,
          contentNegative: draft.negative || null,
          isPinned: draft.isPinned,
          ...(isSlip ? { source: 'manual' as const } : {}),
        })
      : await createPrompt({
          title: draft.title,
          description: draft.description || undefined,
          content: draft.content,
          contentNegative: draft.negative || undefined,
          isPinned: draft.isPinned,
        });

    setSaving(false);
    if (!saved) {
      setSaveError('保存失败，请重试。改动仍保留在表单里。');
      return;
    }
    onSaved?.(saved);
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
      }}
    >
      <DialogContent
        className="max-w-xl p-0"
        hideClose
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <PromptEditorForm
          layout="dialog"
          heading={isSlip ? '誊清这枚笺' : prompt ? '编辑提示词' : '新建提示词'}
          subtitle={
            isSlip
              ? '补全后保存，笺将誊入正式提示词库。支持 Cmd/Ctrl+S 保存。'
              : '标题与正文必填。支持 Cmd/Ctrl+S 保存。'
          }
          initial={initial}
          busy={saving}
          error={saveError}
          negativeCollapsible
          showPin
          submitLabel={prompt ? '保存修改' : '保存'}
          testIds={{
            title: 'editor-title',
            description: 'editor-description',
            content: 'editor-content',
            negative: 'editor-negative',
            negativeToggle: 'editor-negative-toggle',
            submit: 'editor-save',
            discard: 'editor-discard',
          }}
          onCancel={() => {
            setSaveError(null);
            onOpenChange(false);
          }}
          onSubmit={submit}
        />
      </DialogContent>
    </Dialog>
  );
}
