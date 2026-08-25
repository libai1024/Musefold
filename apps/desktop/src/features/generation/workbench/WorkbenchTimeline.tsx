import { useState } from "react";
import type { ReactNode } from "react";
import { ArrowDown } from "../../../components/ui/icons";
import {
  WorkbenchEmptyState,
  WorkbenchTimelineStage,
  useWorkbenchTimelineController,
} from "@musefold/product-ui";
import { ImageLightbox } from "../../../components/image-lightbox";
import { useGenerationWorkbenchStore } from "./store";
import { useSkillRuntimeStore } from "./skill-runtime-store";
import { GenerationTurnView } from "./GenerationTurnView";
import { PendingSkillConversation } from "./PendingSkillConversation";

export function WorkbenchTimeline({
  emptyComposer,
}: {
  /** v2.0(11 §3):新对话空态时内联在品牌锁定区下方的 Composer。 */
  emptyComposer?: ReactNode;
}) {
  const turns = useGenerationWorkbenchStore((s) => s.turns);
  const setDraftPrompt = useGenerationWorkbenchStore((s) => s.setDraftPrompt);
  const attachmentsActive = useGenerationWorkbenchStore(
    (s) =>
      s.refinementContext !== null ||
      s.draftImages.length > 0 ||
      s.draftSource.kind === "scheme",
  );
  const skillSubmittedPrompt = useSkillRuntimeStore(
    (state) => state.submittedPrompt,
  );
  const skillConversationTurnId = useSkillRuntimeStore(
    (state) => state.conversationTurnId,
  );
  const skillTrace = useSkillRuntimeStore((state) => state.trace);
  const pendingSkillConversation = Boolean(
    skillSubmittedPrompt && !skillConversationTurnId,
  );
  const skillTraceSignal = skillTrace
    .map((item) => `${item.id}:${item.status}`)
    .join("|");
  const [zoom, setZoom] = useState<{ path: string; prompt: string } | null>(
    null,
  );
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const timeline = useWorkbenchTimelineController({
    followKey: [
      attachmentsActive,
      pendingSkillConversation,
      skillTraceSignal,
      turns.length,
    ].join("|"),
    itemCount: turns.length + (pendingSkillConversation ? 1 : 0),
  });

  return (
    <WorkbenchTimelineStage
      controller={timeline}
      onPointerDown={(event) => {
        if (!(event.target as Element).closest("[data-user-message]"))
          setActiveMessageId(null);
      }}
      className="relative min-h-0 flex-1 overflow-y-auto"
      itemCount={turns.length + (pendingSkillConversation ? 1 : 0)}
      bottomInset={attachmentsActive ? "attachments" : "composer"}
      empty={
        <WorkbenchEmptyState
          composer={emptyComposer}
          onSelectSuggestion={(suggestion) => {
            setDraftPrompt(suggestion);
            window.requestAnimationFrame(() => {
              const textarea = document.querySelector<HTMLTextAreaElement>(
                '[data-workbench-testid="workbench-prompt"]',
              );
              textarea?.focus();
              textarea?.setSelectionRange(
                suggestion.length,
                suggestion.length,
              );
            });
          }}
        />
      }
      trailing={
        <>
          {!timeline.nearLatest && turns.length > 0 && (
            <button
              type="button"
              onClick={() => timeline.scrollToLatest()}
              className="no-drag sticky bottom-4 left-1/2 z-10 mx-auto flex -translate-x-1/2 items-center gap-1 rounded-full border border-border-default bg-elevated px-3 py-1.5 text-[11px] text-secondary shadow-sm hover:bg-hover hover:text-primary"
              data-testid="generation-back-latest"
            >
              <ArrowDown className="h-3.5 w-3.5" /> 回到最新
            </button>
          )}
          <ImageLightbox
            path={zoom?.path ?? null}
            prompt={zoom?.prompt}
            onClose={() => setZoom(null)}
          />
        </>
      }
    >
      {turns.map((turn) => (
        <GenerationTurnView
          key={turn.id}
          turn={turn}
          messageActionsOpen={activeMessageId === turn.id}
          onMessageActivate={() => setActiveMessageId(turn.id)}
          onMessageClose={() => setActiveMessageId(null)}
          onZoom={(path) => setZoom({ path, prompt: turn.prompt })}
        />
      ))}
      {pendingSkillConversation && skillSubmittedPrompt && (
        <PendingSkillConversation
          prompt={skillSubmittedPrompt}
          trace={skillTrace}
        />
      )}
    </WorkbenchTimelineStage>
  );
}
