import { BookmarkPlus, Check, LoaderCircle } from "@musefold/ui/icons";
import { Button } from "@musefold/ui";

export type GenerationSavePromptState = "idle" | "saving" | "saved";

export interface GenerationSavePromptActionProps {
  state: GenerationSavePromptState;
  onSave: () => void;
  className?: string;
  role?: "button" | "menuitem";
  testId?: string;
}

export function GenerationSavePromptAction({
  state,
  onSave,
  className,
  role = "button",
  testId = "generation-save-prompt",
}: GenerationSavePromptActionProps) {
  const label =
    state === "saved"
      ? "已存为提示词"
      : state === "saving"
        ? "保存中"
        : "存为提示词";

  return (
    <Button
      variant="ghost"
      role={role}
      className={["mf-save-prompt-action", className]
        .filter(Boolean)
        .join(" ")}
      disabled={state !== "idle"}
      onClick={onSave}
      data-testid={testId}
      aria-label={label}
      icon={
        state === "saved" ? (
          <Check aria-hidden="true" />
        ) : state === "saving" ? (
          <LoaderCircle className="mf-spin" aria-hidden="true" />
        ) : (
          <BookmarkPlus aria-hidden="true" />
        )
      }
    >
      <span>{label}</span>
    </Button>
  );
}
