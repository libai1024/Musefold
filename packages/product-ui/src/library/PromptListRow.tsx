import { Button, IconButton } from "@musefold/ui";
import { Check, Copy, FileText } from "@musefold/ui/icons";
import type { PromptListItemViewModel } from "../models";

export interface PromptListRowProps {
  prompt: PromptListItemViewModel;
  compact?: boolean;
  highlighted?: boolean;
  copied?: boolean;
  onOpen?: () => void;
  onCopy?: () => void;
  onUse: () => void;
}

export function PromptListRow({
  prompt,
  compact = false,
  highlighted = false,
  copied = false,
  onOpen,
  onCopy,
  onUse,
}: PromptListRowProps) {
  const summary = prompt.description?.trim() || prompt.content;
  return (
    <article
      className="mf-prompt-row"
      data-compact={compact ? "true" : "false"}
      data-highlighted={highlighted ? "true" : "false"}
      data-prompt-id={prompt.id}
      data-testid="prompt-row"
      role="listitem"
    >
      <Button
        unstyled
        type="button"
        className="mf-prompt-thumb"
        onClick={onOpen}
        aria-label={`查看${prompt.title}`}
        disabled={!onOpen}
        tabIndex={onOpen ? 0 : -1}
      >
        {prompt.imageUrl ? (
          <img src={prompt.imageUrl} alt="" loading="lazy" />
        ) : (
          <FileText aria-hidden="true" />
        )}
      </Button>
      <Button
        unstyled
        type="button"
        className="mf-prompt-main"
        onClick={onOpen}
        disabled={!onOpen}
        tabIndex={onOpen ? 0 : -1}
        data-testid="prompt-row-open"
      >
        <strong>{prompt.title}</strong>
        <span className="mf-prompt-summary">{summary}</span>
        <span className="mf-prompt-meta">
          {prompt.usageCount > 0 && <span>使用 {prompt.usageCount} 次</span>}
          {prompt.updatedAtLabel && <span>{prompt.updatedAtLabel}</span>}
          {prompt.tags && prompt.tags.length > 0 && (
            <span>{prompt.tags.join(" · ")}</span>
          )}
        </span>
      </Button>
      <div className="mf-row-actions">
        {onCopy && (
          <IconButton
            className="mf-icon-button"
            onClick={onCopy}
            label={`复制 ${prompt.title}`}
            title="复制提示词"
          >
            {copied ? (
              <Check aria-hidden="true" />
            ) : (
              <Copy aria-hidden="true" />
            )}
          </IconButton>
        )}
        <Button
          unstyled
          type="button"
          className="mf-text-action"
          onClick={onUse}
          data-testid="prompt-row-use"
        >
          使用
        </Button>
      </div>
    </article>
  );
}
