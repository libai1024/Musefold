import { useEffect } from "react";
import { WorkbenchPageFrame } from "@musefold/product-ui";
import { useAppStore } from "../../../stores/app";
import { useGenerationStore } from "../store";
import { useGenerationWorkbenchStore } from "./store";
import { useSkillRuntimeStore } from "./skill-runtime-store";
import { PromptReferenceSidebar } from "./PromptReferenceSidebar";
import { WorkbenchComposer } from "./WorkbenchComposer";
import { WorkbenchTimeline } from "./WorkbenchTimeline";

export function GenerationWorkbench() {
  const providers = useGenerationStore((s) => s.providers);
  const loadProviders = useGenerationStore((s) => s.loadProviders);
  const refinementContext = useGenerationWorkbenchStore(
    (s) => s.refinementContext,
  );
  const referencesOpen = useAppStore((s) => s.materialLibraryOpen);
  const setReferencesOpen = useAppStore((s) => s.setMaterialLibraryOpen);
  const turnCount = useGenerationWorkbenchStore((s) => s.turns.length);
  const pendingSkillConversation = useSkillRuntimeStore((state) =>
    Boolean(state.submittedPrompt && !state.conversationTurnId),
  );
  // v2.0(11 §1):新对话空态 = 品牌锁定区 + 内联 Composer;已有会话 Composer 贴底。
  const isEmpty = turnCount === 0 && !pendingSkillConversation;

  useEffect(() => {
    if (providers.length === 0) void loadProviders().catch(() => {});
  }, [loadProviders, providers.length]);

  useEffect(() => {
    if (refinementContext) setReferencesOpen(false);
  }, [refinementContext]);

  return (
    <WorkbenchPageFrame
      className="relative flex h-full min-h-0 flex-col"
      stageClassName="relative flex min-h-0 flex-1"
      timeline={
        <WorkbenchTimeline
          emptyComposer={
            isEmpty ? (
              <WorkbenchComposer composerVariant="empty" composerLayout="flow" />
            ) : undefined
          }
        />
      }
      auxiliary={
        referencesOpen ? (
          <PromptReferenceSidebar
            open={referencesOpen}
            onClose={() => setReferencesOpen(false)}
          />
        ) : null
      }
      composer={isEmpty ? null : <WorkbenchComposer />}
    />
  );
}
