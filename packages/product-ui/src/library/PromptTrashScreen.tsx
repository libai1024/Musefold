import { ArrowLeft, RotateCcw, Trash2 } from "@musefold/ui/icons";
import { Button } from "@musefold/ui";
import type { PromptDetailViewModel } from "../models";

export interface PromptTrashScreenProps {
  prompts: PromptDetailViewModel[];
  loading?: boolean;
  error?: string | null;
  busyId?: string | null;
  onBack: () => void;
  onRestore: (prompt: PromptDetailViewModel) => void;
}

export function PromptTrashScreen({
  prompts,
  loading = false,
  error,
  busyId,
  onBack,
  onRestore,
}: PromptTrashScreenProps) {
  return (
    <section className="mf-prompt-trash" data-testid="prompt-trash">
      <header>
        <Button variant="ghost" className="mf-detail-back" onClick={onBack} icon={<ArrowLeft aria-hidden="true" />}>
          提示词库
        </Button>
        <div>
          <h1>回收站</h1>
          <span>{prompts.length}</span>
        </div>
      </header>
      {error && (
        <p className="mf-inline-error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <div className="mf-empty-row">正在载入</div>
      ) : prompts.length === 0 ? (
        <div className="mf-empty-row">
          <Trash2 aria-hidden="true" />
          回收站为空
        </div>
      ) : (
        <div className="mf-trash-list" role="list">
          {prompts.map((prompt) => (
            <article key={prompt.id} role="listitem" data-testid="trash-row">
              <div>
                <strong>{prompt.title}</strong>
                <span>删除于 {prompt.deletedAtLabel}</span>
              </div>
              <Button
                variant="secondary"
                className="mf-secondary-button"
                disabled={busyId === prompt.id}
                onClick={() => onRestore(prompt)}
                data-testid="trash-restore"
                icon={<RotateCcw aria-hidden="true" />}
              >
                {busyId === prompt.id ? "恢复中" : "恢复"}
              </Button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
