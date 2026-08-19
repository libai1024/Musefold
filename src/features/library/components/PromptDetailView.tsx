// src/features/library/components/PromptDetailView.tsx
// 提示词详情 —— 880px 轻量详情页（v0.3.2 重塑，替代 320px 常驻检视器）。
// 结构对齐方案详情：返回 > 头部（标记/标题/元信息 + 菜单 + 主动作）> 正文 > 相关作品 > 元数据。

import { useState } from "react";
import { Blocks, Share2 } from "../../../components/ui/icons";
import type { Prompt } from "@shared/types/models";
import { useLibraryStore } from "../store";
import { useGenerationWorkbenchStore } from "../../generation/workbench/store";
import { useAppStore } from "../../../stores/app";
import { toImageSrc } from "../../../lib/media";
import { formatTime } from "../../../lib/format";
import { toast } from "../../../stores/toast";
import { promptParamsToRefineParams } from "../../generation/promptParams";
import { SharePromptDialog } from "../../share/SharePromptDialog";
import { PromptWorksPanel } from "./PromptWorksPanel";
import {
  PromptDetailScreen,
  type PromptDetailViewModel,
} from "@musefold/product-ui";

const SOURCE_LABEL: Record<Prompt["source"], string> = {
  manual: "本机创建",
  import: "导入",
  shared: "分享导入",
  slip: "笺 · 朱点速记",
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
  const [shareOpen, setShareOpen] = useState(false);

  const use = () => {
    const params = prompt.params
      ? promptParamsToRefineParams(prompt.params)
      : undefined;
    openDraft({
      prompt: prompt.content,
      negative: prompt.contentNegative ?? "",
      source: {
        kind: "prompt",
        id: prompt.id,
        label: prompt.title,
        content: prompt.content,
      },
      params,
    });
    toast.success("已送入制作", prompt.title);
  };

  const createScheme = () => {
    const seed = [
      "把这段提示词整理成一个可以反复使用的方案，区分固定规则、必需变量和本次补充。",
      "",
      prompt.content,
      prompt.contentNegative ? `\n避免：${prompt.contentNegative}` : "",
    ]
      .join("\n")
      .trim();
    setDraftCommand("design-plan");
    setDraftPrompt(seed);
    setView("generate");
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
    sourceLabel: SOURCE_LABEL[prompt.source] ?? "本机创建",
    createdAtLabel: formatTime(prompt.createdAt),
    updatedAtLabel: formatTime(prompt.updatedAt),
    deletedAtLabel: null,
  };

  return (
    <>
      <PromptDetailScreen
        prompt={detailViewModel}
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
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                closeMenu();
                setShareOpen(true);
              }}
              data-testid="detail-share"
            >
              <Share2 aria-hidden="true" />
              分享
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                closeMenu();
                createScheme();
              }}
              data-testid="detail-create-scheme"
            >
              <Blocks aria-hidden="true" />
              创建方案
            </button>
          </>
        )}
        bodyExtra={<PromptWorksPanel prompt={prompt} />}
      />
      <SharePromptDialog
        open={shareOpen}
        prompt={prompt}
        onOpenChange={setShareOpen}
      />
    </>
  );
}
