import type { Dispatch, FormEvent, MutableRefObject, SetStateAction } from "react";
import type { DesktopLibraryPrompt } from "@musefold/desktop-contracts/library-documents";
import type { GenerationSource } from "./types";
import type { useWorkbenchComposerStore } from "./useWorkbenchComposerStore";

export type ComposerPresentationMode =
  | "image"
  | "design-plan"
  | "refinement"
  | "scheme"
  | "skill";

type Store = ReturnType<typeof useWorkbenchComposerStore>;

export type WorkbenchComposerViewProps = Store & {
  textareaRef: { current: HTMLTextAreaElement | null };
  composerSurfaceRef: { current: HTMLDivElement | null };
  imageInputRef: { current: HTMLInputElement | null };
  dragDepthRef: MutableRefObject<number>;
  imageBusy: boolean;
  dragActive: boolean;
  setDragActive: Dispatch<SetStateAction<boolean>>;
  previewPath: string | null;
  setPreviewPath: Dispatch<SetStateAction<string | null>>;
  composerMenuOpen: boolean;
  setComposerMenuOpen: Dispatch<SetStateAction<boolean>>;
  schemePickerOpen: boolean;
  setSchemePickerOpen: Dispatch<SetStateAction<boolean>>;
  promptPickerOpen: boolean;
  setPromptPickerOpen: Dispatch<SetStateAction<boolean>>;
  historySourceOpen: boolean;
  setHistorySourceOpen: Dispatch<SetStateAction<boolean>>;
  commandHintIndex: number;
  setCommandHintIndex: Dispatch<SetStateAction<number>>;
  setCommandHintsDismissed: Dispatch<SetStateAction<boolean>>;
  commandHintsVisible: boolean;
  activeCommandHintIndex: number;
  effectiveImageCount: number;
  sourceBlockVisible: boolean;
  attachmentStripVisible: boolean;
  plainSource: GenerationSource | null;
  plainSourcePreview: string | undefined;
  selectCommandHint: () => void;
  pickImage: () => void;
  importGithubFromClipboard: () => void | Promise<void>;
  applyPromptReference: (target: DesktopLibraryPrompt) => void;
  handleClearSource: () => void;
  handleSubmit: (event?: FormEvent) => void | Promise<void>;
  stageImageFiles: (files: File[]) => void | Promise<void>;
  removeReferenceAt: (index: number) => void;
  composerMode: ComposerPresentationMode;
  composerModeLocked: boolean;
  setComposerMode: (mode: "image" | "design-plan") => void;
  /** v2.0 空态内联变体(11 §5):empty + flow 时 Composer 渲染在品牌锁定区下方。 */
  composerVariant?: "empty" | "active";
  composerLayout?: "floating" | "flow";
};
