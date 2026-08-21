import { useEffect } from "react";
import { WorkbenchPageFrame } from "@musefold/product-ui";
import { useAppStore } from "../../../stores/app";
import { useGenerationStore } from "../store";
import { useGenerationWorkbenchStore } from "./store";
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
      timeline={<WorkbenchTimeline />}
      auxiliary={
        referencesOpen ? (
          <PromptReferenceSidebar
            open={referencesOpen}
            onClose={() => setReferencesOpen(false)}
          />
        ) : null
      }
      composer={<WorkbenchComposer />}
    />
  );
}
