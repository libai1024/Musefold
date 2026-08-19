import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SlidersHorizontal, X } from "@musefold/ui/icons";
import { Button, IconButton, Textarea } from "@musefold/ui";
import { useWorkbenchPopoverPosition } from "./useWorkbenchPopoverPosition";

export interface WorkbenchGenerationQualityOption {
  id: string;
  label: string;
  hint?: string;
}

export interface WorkbenchGenerationSettingsProps {
  quality: string;
  qualityOptions: readonly WorkbenchGenerationQualityOption[];
  onQualityChange: (quality: string) => void;
  count?: number;
  countOptions?: readonly number[];
  onCountChange?: (count: number) => void;
  negative?: string;
  onNegativeChange?: (negative: string) => void;
  managedLabel?: string;
  managedDescription?: string;
  testId?: string;
}

export function WorkbenchGenerationSettingsPopover({
  quality,
  qualityOptions,
  onQualityChange,
  count,
  countOptions,
  onCountChange,
  negative,
  onNegativeChange,
  managedLabel,
  managedDescription,
  testId = "workbench-more-settings",
}: WorkbenchGenerationSettingsProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selectedQuality =
    qualityOptions.find((option) => option.id === quality) ?? qualityOptions[0];
  const managed = Boolean(managedLabel);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        !rootRef.current?.contains(event.target as Node) &&
        !menuRef.current?.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };
  const menuStyle = useWorkbenchPopoverPosition({
    open,
    anchorRef: triggerRef,
    menuRef,
    maxHeight: 520,
  });
  if (!selectedQuality) return null;

  return (
    <div className="mf-workbench-generation-settings" ref={rootRef}>
      <Button
        ref={triggerRef}
        variant="secondary"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={
          managedLabel
            ? `生成设置：${managedLabel}`
            : `生成设置：${selectedQuality.label}${count ? `，${count} 张` : ""}`
        }
        title="生成设置"
        onClick={() => setOpen((current) => !current)}
        data-testid={testId}
        data-open={open ? "true" : "false"}
        className="mf-workbench-generation-trigger"
        icon={<SlidersHorizontal aria-hidden="true" />}
      >
        <span>
          {managedLabel ??
            `${selectedQuality.label}${count ? ` · ${count}张` : ""}`}
        </span>
      </Button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              className="mf-workbench-generation-menu"
              style={menuStyle}
              role="dialog"
              aria-label="生成设置"
              data-testid="workbench-generation-options"
            >
              <div className="mf-workbench-generation-heading">
                <strong>生成设置</strong>
                <IconButton
                  onClick={() => close(true)}
                  title="关闭"
                  label="关闭生成设置"
                >
                  <X aria-hidden="true" />
                </IconButton>
              </div>
              {managed ? (
                <div className="mf-workbench-generation-managed">
                  <strong>{managedLabel}</strong>
                  <span>{managedDescription}</span>
                </div>
              ) : (
                <>
                  <fieldset>
                    <legend>质量</legend>
                    <div role="radiogroup" aria-label="图片质量">
                      {qualityOptions.map((option) => {
                        const active = option.id === quality;
                        return (
                          <Button
                            variant="ghost"
                            key={option.id}
                            role="radio"
                            aria-checked={active}
                            title={option.hint}
                            data-active={active ? "true" : "false"}
                            data-testid={`refine-quality-${option.id}`}
                            onClick={() => onQualityChange(option.id)}
                          >
                            {option.label}
                          </Button>
                        );
                      })}
                    </div>
                  </fieldset>
                  {countOptions && onCountChange && count !== undefined ? (
                    <fieldset>
                      <legend>数量</legend>
                      <div role="radiogroup" aria-label="生成数量">
                        {countOptions.map((option) => (
                          <Button
                            variant="ghost"
                            key={option}
                            role="radio"
                            aria-checked={count === option}
                            data-active={count === option ? "true" : "false"}
                            data-testid={`refine-count-${option}`}
                            onClick={() => onCountChange(option)}
                          >
                            {option} 张
                          </Button>
                        ))}
                      </div>
                    </fieldset>
                  ) : null}
                  {negative !== undefined && onNegativeChange ? (
                    <label className="mf-workbench-negative-prompt">
                      <span>反向提示词</span>
                      <Textarea
                        value={negative}
                        onChange={(event) =>
                          onNegativeChange(event.target.value)
                        }
                        rows={2}
                        placeholder="不希望出现的元素…"
                        data-testid="refine-negative"
                      />
                    </label>
                  ) : null}
                </>
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
