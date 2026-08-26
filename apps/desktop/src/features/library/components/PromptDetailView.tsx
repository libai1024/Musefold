// src/features/library/components/PromptDetailView.tsx
// 提示词详情 —— 同时服务 880px 详情页与方案中心同款 Inspector。
// 结构：导航栏 > 头部（标记/标题/元信息 + 菜单 + 主动作）> 正文 > 相关作品 > 元数据。

import { useState } from 'react';
import { DropdownMenuItem } from '@musefold/ui';
import { Blocks, Share2 } from '../../../components/ui/icons';
import type { DesktopLibraryPrompt } from '@musefold/desktop-contracts/library-documents';
import { useLibraryStore } from '../store';
import { useGenerationWorkbenchStore } from '../../../runtime/workbench-access';
import { useAppStore } from '../../../stores/app';
import { toImageSrc } from '../../../lib/media';
import { formatTime } from '../../../lib/format';
import { toast } from '../../../stores/toast';
import { promptParamsToRefineParams } from '../../../lib/prompt-params';
import { SharePromptDialog } from '../../../runtime/share-access';
import { PromptWorksPanel } from './PromptWorksPanel';
import { PromptDetailScreen, type PromptDetailViewModel } from '@musefold/product-ui';

const SOURCE_LABEL: Record<DesktopLibraryPrompt['source'], string> = {
  manual: '本机创建',
  import: '导入',
  share: '分享导入',
  slip: '笺 · 朱点速记',
  generation: '生成入库',
};

export function PromptDetailView({
  prompt,
  onBack,
  onEdit,
  layout = 'page',
}: {
  prompt: DesktopLibraryPrompt;
  onBack: () => void;
  onEdit: (p: DesktopLibraryPrompt) => void;
  layout?: 'page' | 'inspector';
}) {
  const copyContent = useLibraryStore((s) => s.copyContent);
  const togglePin = useLibraryStore((s) => s.togglePin);
  const deletePrompt = useLibraryStore((s) => s.deletePrompt);
  const openDraft = useGenerationWorkbenchStore((s) => s.openDraft);
  const setDraftCommand = useGenerationWorkbenchStore((s) => s.setDraftCommand);
  const setDraftPrompt = useGenerationWorkbenchStore((s) => s.setDraftPrompt);
  const setView = useAppStore((s) => s.setView);
  const [shareOpen, setShareOpen] = useState(false);

  const use = () => {
    const params = prompt.params ? promptParamsToRefineParams(prompt.params) : undefined;
    openDraft({
      prompt: prompt.content,
      negative: prompt.contentNegative ?? '',
      source: {
        kind: 'prompt',
        id: prompt.id,
        label: prompt.title,
        content: prompt.content,
      },
      params,
    });
    toast.success('已送入制作', prompt.title);
  };

  const createScheme = () => {
    const seed = [
      '把这段提示词整理成一个可以反复使用的方案，区分固定规则、必需变量和本次补充。',
      '',
      prompt.content,
      prompt.contentNegative ? `\n避免：${prompt.contentNegative}` : '',
    ]
      .join('\n')
      .trim();
    setDraftCommand('design-plan');
    setDraftPrompt(seed);
    setView('generate');
  };

  const remove = async () => {
    const ok = await deletePrompt(prompt.id);
    if (ok) onBack();
  };

  const detailViewModel: PromptDetailViewModel = {
    id: prompt.id,
    title: prompt.title,
    description: prompt.description,
    content: prompt.content,
    negative: prompt.contentNegative,
    imageUrl: prompt.coverImagePath ? toImageSrc(prompt.coverImagePath) : null,
    usageCount: prompt.usageCount,
    tags: prompt.tags.map((tag) => tag.name),
    isPinned: prompt.isPinned,
    sourceLabel: SOURCE_LABEL[prompt.source] ?? '本机创建',
    createdAtLabel: formatTime(prompt.createdAtMs),
    updatedAtLabel: formatTime(prompt.updatedAtMs),
    deletedAtLabel: null,
  };

  return (
    <>
      <PromptDetailScreen
        prompt={detailViewModel}
        layout={layout}
        onBack={onBack}
        onUse={use}
        onEdit={() => onEdit(prompt)}
        onCopy={() => {
          void copyContent(prompt.id);
        }}
        onTogglePin={() => {
          void togglePin(prompt.id);
        }}
        onDelete={remove}
        additionalMenuItems={(closeMenu) => (
          <>
            <DropdownMenuItem
              onSelect={() => {
                closeMenu();
                setShareOpen(true);
              }}
              data-testid="detail-share"
            >
              <Share2 aria-hidden="true" />
              分享
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                closeMenu();
                createScheme();
              }}
              data-testid="detail-create-scheme"
            >
              <Blocks aria-hidden="true" />
              创建方案
            </DropdownMenuItem>
          </>
        )}
        bodyExtra={<PromptWorksPanel prompt={prompt} />}
      />
      <SharePromptDialog open={shareOpen} prompt={prompt} onOpenChange={setShareOpen} />
    </>
  );
}
