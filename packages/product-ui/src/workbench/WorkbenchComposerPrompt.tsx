import {
  forwardRef,
  useLayoutEffect,
  useRef,
  type FormEvent,
  type TextareaHTMLAttributes,
} from "react";
import { Textarea } from "@musefold/ui";

export interface WorkbenchComposerPromptProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  autoResize?: boolean;
}

/** Shared prompt input geometry; hosts provide intent, chips and submit policy. */
export const WorkbenchComposerPrompt = forwardRef<
  HTMLTextAreaElement,
  WorkbenchComposerPromptProps
>(function WorkbenchComposerPrompt(
  { autoResize = true, className, onInput, value, ...textareaProps },
  forwardedRef,
) {
  const localRef = useRef<HTMLTextAreaElement | null>(null);
  const resize = () => {
    const element = localRef.current;
    if (!autoResize || !element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(Math.max(element.scrollHeight, 76), 180)}px`;
  };

  useLayoutEffect(resize, [autoResize, value]);

  const setRef = (element: HTMLTextAreaElement | null) => {
    localRef.current = element;
    if (typeof forwardedRef === "function") forwardedRef(element);
    else if (forwardedRef) forwardedRef.current = element;
  };

  const handleInput = (event: FormEvent<HTMLTextAreaElement>) => {
    resize();
    onInput?.(event);
  };

  return (
    <Textarea
      {...textareaProps}
      ref={setRef}
      value={value}
      onInput={handleInput}
      className={["mf-workbench-prompt", className].filter(Boolean).join(" ")}
    />
  );
});
