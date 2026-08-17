// src/features/library/components/PromptDetailView.tsx
// 提示词详情 —— 880px 轻量详情页（v0.3.2 重塑，替代 320px 常驻检视器）。
// 结构对齐方案详情：返回 > 头部（标记/标题/元信息 + 菜单 + 主动作）> 正文 > 相关作品 > 元数据。

import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Blocks,
  Copy,
  FileText,
  MoreHorizontal,
  Pencil,
  Pin,
  Share2,
  Sparkles,
  Trash2,
} from '../../../components/ui/icons';
import type { Prompt } from '@shared/types/models';
import { useLibraryStore } from '../store';
import { useGenerationWorkbenchStore } from '../../generation/workbench/store';
import { useAppStore } from '../../../stores/app';
import { toImageSrc } from '../../../lib/media';
import { formatTime } from '../../../lib/format';
import { toast } from '../../../stores/toast';
import { promptParamsToRefineParams } from '../../generation/promptParams';
import { SharePromptDialog } from '../../share/SharePromptDialog';
import { PromptWorksPanel } from './PromptWorksPanel';

const SOURCE_LABEL: Record<Prompt['source'], string> = {
  manual: '本机创建',
  import: '导入',
  shared: '分享导入',
  slip: '笺 · 朱点速记',
};

export function PromptDetailView({
  prompt,
  onBack,
  onEdit,
}: {
  prompt: Prompt;
  onBack: () => void;
  onEdit: (p: Prompt) => void;
}) {
  const copyContent = useLibraryStore((s) => s.copyContent);
  const togglePin = useLibraryStore((s) => s.togglePin);
  const deletePrompt = useLibraryStore((s) => s.deletePrompt);
  const openDraft = useGenerationWorkbenchStore((s) => s.openDraft);
  const setDraftCommand = useGenerationWorkbenchStore((s) => s.setDraftCommand);
  const setDraftPrompt = useGenerationWorkbenchStore((s) => s.setDraftPrompt);
  const setView = useAppStore((s) => s.setView);
  const [menuOpen, setMenuOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const menuRootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const use = () => {
    const params = prompt.params ? promptParamsToRefineParams(prompt.params) : undefined;
    openDraft({
      prompt: prompt.content,
      negative: prompt.contentNegative ?? '',
      source: { kind: 'prompt', id: prompt.id, label: prompt.title },
      params,
    });
    toast.success('已送入制作', prompt.title);
  };

  const createScheme = () => {
    setMenuOpen(false);
    const seed = [
      '把这段提示词整理成一个可以反复使用的方案，区分固定规则、必需变量和本次补充。',
      '',
      prompt.content,
      prompt.contentNegative ? `\n避免：${prompt.contentNegative}` : '',
    ].join('\n').trim();
    setDraftCommand('design-plan');
    setDraftPrompt(seed);
    setView('generate');
  };

  const remove = async () => {
    setMenuOpen(false);
    const ok = await deletePrompt(prompt.id);
    if (ok) onBack();
  };

  return (
    <div className="h-full overflow-y-auto" data-testid="prompt-detail" data-prompt-id={prompt.id}>
      <div className="mx-auto w-full max-w-[880px] px-6 pb-16 pt-5 max-[640px]:px-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-md pr-2 text-[11px] text-tertiary hover:bg-hover hover:text-primary"
          data-testid="detail-back"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          提示词
        </button>

        <div className="mt-5 flex items-start gap-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border-subtle bg-inset/55" aria-hidden="true">
            {prompt.coverImagePath ? (
              <img src={toImageSrc(prompt.coverImagePath)} alt="" className="h-full w-full object-cover" />
            ) : (
              <FileText className="h-4 w-4 text-secondary" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[20px] font-semibold leading-tight text-primary" data-testid="detail-title">
                {prompt.title}
              </h1>
              {prompt.isPinned && <Pin className="h-3.5 w-3.5 shrink-0 text-tertiary" aria-label="已置顶" />}
            </div>
            {prompt.description && (
              <p className="mt-1.5 max-w-[62ch] text-[12px] leading-5 text-secondary">{prompt.description}</p>
            )}
            <p className="mt-2 text-[10.5px] text-tertiary">
              {SOURCE_LABEL[prompt.source] ?? '本机创建'} · 使用 {prompt.usageCount} 次 · 更新于 {formatTime(prompt.updatedAt)}
            </p>
          </div>
          <div className="relative flex shrink-0 items-center gap-1" ref={menuRootRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="icon-action h-8 w-8"
              aria-label="更多操作"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              title="更多操作"
              data-testid="detail-menu"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={use}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[11px] font-semibold text-background hover:opacity-85"
              data-testid="detail-generate"
            >
              <Sparkles className="h-3.5 w-3.5" />
              使用
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-[calc(100%+6px)] z-30 w-44 rounded-lg border border-border-default bg-popover p-1.5 shadow-pop animate-scale-fade-in" role="menu" aria-label="提示词操作">
                <button type="button" role="menuitem" className="menu-action rounded-md" onClick={() => { setMenuOpen(false); onEdit(prompt); }} data-testid="detail-edit">
                  <Pencil className="h-3.5 w-3.5" /> 编辑
                </button>
                <button type="button" role="menuitem" className="menu-action rounded-md" onClick={() => { setMenuOpen(false); void copyContent(prompt.id); }} data-testid="detail-copy">
                  <Copy className="h-3.5 w-3.5" /> 复制正文
                </button>
                <button type="button" role="menuitem" className="menu-action rounded-md" onClick={() => { setMenuOpen(false); void togglePin(prompt.id); }} data-testid="detail-pin">
                  <Pin className="h-3.5 w-3.5" /> {prompt.isPinned ? '取消置顶' : '置顶'}
                </button>
                <button type="button" role="menuitem" className="menu-action rounded-md" onClick={() => { setMenuOpen(false); setShareOpen(true); }} data-testid="detail-share">
                  <Share2 className="h-3.5 w-3.5" /> 分享
                </button>
                <button type="button" role="menuitem" className="menu-action rounded-md" onClick={createScheme} data-testid="detail-create-scheme">
                  <Blocks className="h-3.5 w-3.5" /> 创建方案
                </button>
                <div className="my-1.5 h-px bg-border-subtle" />
                <button type="button" role="menuitem" className="menu-action rounded-md text-danger hover:text-danger" onClick={() => void remove()} data-testid="detail-delete">
                  <Trash2 className="h-3.5 w-3.5" /> 删除
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="mt-8 space-y-7">
          <section>
            <h2 className="text-[13px] font-semibold text-primary">正文</h2>
            <pre
              className="mt-3 max-h-[360px] overflow-auto whitespace-pre-wrap break-words rounded-md bg-inset px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-secondary"
              data-testid="detail-content"
            >
              {prompt.content}
            </pre>
          </section>

          {prompt.contentNegative && (
            <section className="border-t border-border-subtle pt-5">
              <h2 className="text-[13px] font-semibold text-primary">负面提示词</h2>
              <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-inset px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-tertiary" data-testid="detail-negative">
                {prompt.contentNegative}
              </pre>
            </section>
          )}

          <PromptWorksPanel prompt={prompt} />

          <section className="border-t border-border-subtle pt-5">
            <h2 className="text-[13px] font-semibold text-primary">详情</h2>
            <div className="mt-3 grid gap-3 text-[11.5px] leading-6 text-secondary sm:grid-cols-3">
              <div>
                <span className="block text-tertiary">创建</span>
                <span className="mt-0.5 block text-primary">{formatTime(prompt.createdAt)}</span>
              </div>
              <div>
                <span className="block text-tertiary">更新</span>
                <span className="mt-0.5 block text-primary">{formatTime(prompt.updatedAt)}</span>
              </div>
              <div>
                <span className="block text-tertiary">使用次数</span>
                <span className="mt-0.5 block text-primary tabular-nums">{prompt.usageCount}</span>
              </div>
            </div>
          </section>
        </div>
      </div>
      <SharePromptDialog open={shareOpen} prompt={prompt} onOpenChange={setShareOpen} />
    </div>
  );
}
