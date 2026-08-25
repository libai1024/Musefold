import { Blocks, FileText, GitBranch } from "../../../components/ui/icons";
import { toImageSrc } from "../../../lib/media";
import { useAppStore } from "../../../stores/app";
import type { GenerationTurn } from "./types";

export function GenerationTurnUserAttachments({
  turn,
  onZoom,
}: {
  turn: GenerationTurn;
  onZoom: (path: string) => void;
}) {
  return (
            (turn.source.kind === "skill" ||
              turn.source.kind === "scheme-run" ||
              (turn.source.kind === "scheme-creation" &&
                turn.source.githubUrl) ||
              turn.referenceImages.length > 0 ||
              turn.references.length > 0) && (
              <div
                className="mf-workbench-user-attachments mb-1.5 flex max-w-full flex-col items-end gap-1.5"
                data-testid="generation-message-attachments"
              >
                {turn.source.kind === "scheme-run" && (
                  <button
                    type="button"
                    onClick={() =>
                      useAppStore.getState().requestSchemeCenter({
                        detailId:
                          turn.source.kind === "scheme-run"
                            ? turn.source.schemeId
                            : undefined,
                      })
                    }
                    className="flex max-w-full items-center gap-2 rounded-lg border border-border-subtle bg-elevated px-2.5 py-1.5 text-left transition-colors hover:border-border-default hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                    title="查看方案详情"
                    data-testid="generation-scheme-run-reference"
                  >
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent"
                      aria-hidden
                    >
                      <Blocks className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-meta font-medium text-primary">
                        {turn.source.label}
                      </span>
                      <span className="block text-meta text-tertiary">
                        {turn.source.mode === "trial"
                          ? "设计方案 · 试运行"
                          : "引用设计方案"}
                        {turn.source.isRepairRun ? " · 修复重跑" : ""}
                      </span>
                    </span>
                  </button>
                )}
                {turn.source.kind === "skill" && (
                  <div
                    className="flex max-w-full items-center gap-2 rounded-lg border border-border-subtle bg-elevated px-2.5 py-1.5"
                    title={turn.source.repositoryUrl}
                    data-testid="generation-skill-reference"
                  >
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent"
                      aria-hidden
                    >
                      <GitBranch className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-meta font-medium text-primary">
                        {turn.source.label}
                      </span>
                      <span className="block text-meta text-tertiary">
                        {turn.source.executionMode === "direct-forward"
                          ? "GitHub Skill · 直传豆包"
                          : "GitHub Skill"}
                      </span>
                    </span>
                  </div>
                )}
                {turn.source.kind === "scheme-creation" &&
                  turn.source.githubUrl && (
                    <div
                      className="flex max-w-full items-center gap-2 rounded-lg border border-border-subtle bg-elevated px-2.5 py-1.5"
                      title={turn.source.githubUrl}
                      data-testid="generation-scheme-creation-reference"
                    >
                      <span
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent"
                        aria-hidden
                      >
                        <GitBranch className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-meta font-medium text-primary">
                          {turn.source.label}
                        </span>
                        <span className="block text-meta text-tertiary">
                          方案来源
                        </span>
                      </span>
                    </div>
                  )}
                {turn.referenceImages.length > 0 && (
                  <div
                    className="flex max-w-full gap-1.5 overflow-x-auto"
                    data-testid="generation-user-reference-images"
                  >
                    {turn.referenceImages.map((image, index) => (
                      <button
                        key={`${image.source}:${image.historyId ?? image.path}:${index}`}
                        type="button"
                        onClick={() => onZoom(image.path)}
                        className="relative shrink-0 cursor-zoom-in overflow-hidden rounded-md border border-border-subtle bg-elevated"
                        title={`查看图 ${index + 1}`}
                        aria-label={`查看参考图 ${index + 1}`}
                        data-testid="generation-user-reference-image"
                      >
                        <img
                          src={toImageSrc(image.path)}
                          alt={`图 ${index + 1}`}
                          className="h-16 w-16 object-contain"
                        />
                        <span className="absolute bottom-1 left-1 rounded bg-black/65 px-1 py-0.5 text-[8px] leading-none text-white">
                          图 {index + 1}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {turn.references.length > 0 && (
                  <div
                    className="flex max-w-full flex-wrap justify-end gap-1.5"
                    data-testid="generation-reference-count"
                  >
                    {turn.references.map((reference, index) => (
                      <span
                        key={`${reference.promptId}:${index}`}
                        className="inline-flex h-[22px] max-w-[200px] items-center gap-1 rounded-md border border-border-subtle bg-elevated px-1.5 text-meta font-medium leading-none text-primary"
                        title={
                          reference.text.length > 300
                            ? `${reference.text.slice(0, 300)}…`
                            : reference.text
                        }
                        data-testid="generation-reference-chip"
                        data-reference-scope={reference.scope}
                      >
                        <FileText className="h-3 w-3 shrink-0 text-secondary" />
                        <span className="min-w-0 truncate">
                          {reference.title}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
  );
}
