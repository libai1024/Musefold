import type { ComposerPresentationMode } from "./workbenchComposerViewProps";

export function composerPresentationMode(input: {
  refinementContext: unknown;
  schemeSource: { mode: string } | null;
  skillRuntimeStatus: string;
  designPlanIntent: unknown;
  draftCommand: string | null;
}): ComposerPresentationMode {
  if (input.refinementContext) return "refinement";
  if (input.schemeSource) return "scheme";
  if (
    input.skillRuntimeStatus === "ready" &&
    input.draftCommand === "design-plan"
  ) {
    return "design-plan";
  }
  if (input.skillRuntimeStatus !== "idle") return "skill";
  if (input.designPlanIntent || input.draftCommand === "design-plan") {
    return "design-plan";
  }
  return "image";
}

export function composerPresentationModeLocked(
  mode: ComposerPresentationMode,
): boolean {
  return mode !== "image" && mode !== "design-plan";
}
