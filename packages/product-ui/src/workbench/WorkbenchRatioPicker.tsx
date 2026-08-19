import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "@musefold/ui/icons";
import { Button } from "@musefold/ui";
import { useWorkbenchPopoverPosition } from "./useWorkbenchPopoverPosition";

export interface WorkbenchRatioOption {
  id: string;
  label: string;
  ratio: string;
  detail?: string;
}

export interface WorkbenchRatioPickerProps {
  value: string;
  options: readonly WorkbenchRatioOption[];
  onChange: (value: string) => void;
  testIdPrefix?: string;
  className?: string;
  allowCustomRatio?: boolean;
}

function ratioShape(ratioId: string): { width: number; height: number } {
  const [width, height] = ratioId.split(":").map(Number);
  const ratio = width > 0 && height > 0 ? width / height : 1;
  if (ratio >= 1)
    return { width: 26, height: Math.max(9, Math.round(26 / ratio)) };
  return { width: Math.max(9, Math.round(26 * ratio)), height: 26 };
}

function customRatio(value: string): WorkbenchRatioOption | null {
  const match = /^custom:(\d{1,2}):(\d{1,2})$/.exec(value);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  const ratio = width / height;
  if (width < 1 || height < 1 || ratio > 4 || ratio < 1 / 4) return null;
  return {
    id: value,
    label: "自定义",
    ratio: `${width}:${height}`,
    detail: `${width}:${height}`,
  };
}

function preview(
  option: WorkbenchRatioOption,
  className = "",
  testId?: string,
) {
  const shape = ratioShape(option.ratio);
  const auto = option.id === "auto";
  return (
    <span
      className={`mf-workbench-ratio-preview ${auto ? "is-auto" : ""} ${className}`}
      style={{ width: shape.width, height: shape.height }}
      aria-hidden="true"
      data-testid={testId}
    >
      {auto ? <span /> : null}
    </span>
  );
}

export function WorkbenchRatioPicker({
  value,
  options,
  onChange,
  testIdPrefix,
  className,
  allowCustomRatio = false,
}: WorkbenchRatioPickerProps) {
  const [open, setOpen] = useState(false);
  const pickerId = useId().replace(/:/g, "");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selected =
    options.find((option) => option.id === value) ??
    customRatio(value) ??
    options[0];
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.id === selected.id),
  );
  const customSelected = selected.id.startsWith("custom:");
  const [customWidth, setCustomWidth] = useState(
    customSelected ? selected.ratio.split(":")[0] : "",
  );
  const [customHeight, setCustomHeight] = useState(
    customSelected ? selected.ratio.split(":")[1] : "",
  );
  const [customTouched, setCustomTouched] = useState(false);

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
    const focusSelected = () => optionRefs.current[selectedIndex]?.focus();
    const frame = window.requestAnimationFrame(focusSelected);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!customSelected) return;
    setCustomWidth(selected.ratio.split(":")[0] ?? "");
    setCustomHeight(selected.ratio.split(":")[1] ?? "");
  }, [customSelected, selected.ratio]);

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  const focusOption = (index: number) => {
    const nextIndex = (index + options.length) % options.length;
    optionRefs.current[nextIndex]?.focus();
  };

  const onOptionKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      focusOption(index + 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      focusOption(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusOption(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusOption(options.length - 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    }
  };

  const applyCustom = () => {
    setCustomTouched(true);
    const candidate = `custom:${customWidth}:${customHeight}`;
    if (customRatio(candidate)) {
      onChange(candidate);
      close(true);
    }
  };
  const customCandidate = `custom:${customWidth}:${customHeight}`;
  const customValid = Boolean(customRatio(customCandidate));
  const menuStyle = useWorkbenchPopoverPosition({
    open,
    anchorRef: triggerRef,
    menuRef,
    maxHeight: 520,
  });

  if (!selected) return null;

  return (
    <div
      className={`mf-workbench-ratio-picker ${className ?? ""}`}
      ref={rootRef}
    >
      <Button
        ref={triggerRef}
        variant="secondary"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? pickerId : undefined}
        aria-label={`图片比例：${selected.ratio} ${selected.label}`}
        title="图片比例"
        data-value={selected.id}
        data-open={open ? "true" : "false"}
        data-testid={testIdPrefix ? `${testIdPrefix}-trigger` : undefined}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (
            event.key === "ArrowDown" ||
            event.key === "ArrowUp" ||
            event.key === "Enter" ||
            event.key === " "
          ) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className="mf-workbench-ratio-trigger"
      >
        {preview(
          selected,
          "",
          testIdPrefix ? `${testIdPrefix}-selected-preview` : undefined,
        )}
        <span>
          {selected.id.startsWith("custom:") ? selected.ratio : selected.id}
        </span>
        <ChevronDown aria-hidden="true" />
      </Button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              id={pickerId}
              role="dialog"
              aria-label="图片比例"
              className="mf-workbench-ratio-menu"
              style={menuStyle}
              data-testid={testIdPrefix ? `${testIdPrefix}-menu` : undefined}
            >
              <div className="mf-workbench-ratio-heading">
                <strong>图片比例</strong>
                <span>{selected.detail ?? selected.ratio}</span>
              </div>
              <div
                className="mf-workbench-ratio-grid"
                role="listbox"
                aria-label="图片比例"
              >
                {options.map((option, index) => {
                  const active = option.id === selected.id;
                  return (
                    <Button
                      key={option.id}
                      ref={(element) => {
                        optionRefs.current[index] = element;
                      }}
                      type="button"
                      role="option"
                      aria-selected={active}
                      aria-label={`${option.ratio}，${option.label}${option.detail ? `，${option.detail}` : ""}`}
                      data-active={active ? "true" : "false"}
                      data-ratio-id={option.id}
                      data-testid={
                        testIdPrefix
                          ? `${testIdPrefix}-${option.id}`
                          : undefined
                      }
                      tabIndex={active ? 0 : -1}
                      autoFocus={active}
                      onClick={() => {
                        onChange(option.id);
                        close(true);
                      }}
                      onKeyDown={(event) => onOptionKeyDown(event, index)}
                      className="mf-workbench-ratio-option"
                    >
                      {preview(
                        option,
                        "is-card",
                        testIdPrefix
                          ? `${testIdPrefix}-${option.id}-preview`
                          : undefined,
                      )}
                      <span>{option.id}</span>
                      <small>{option.label}</small>
                      {active ? <Check aria-hidden="true" /> : null}
                    </Button>
                  );
                })}
              </div>
              {allowCustomRatio && (
                <div className="mf-workbench-custom-ratio">
                  <div>
                    <span>自定义{customSelected ? " · 当前" : ""}</span>
                    <label>
                      <input
                        value={customWidth}
                        onChange={(event) =>
                          setCustomWidth(
                            event.target.value.replace(/\D/g, "").slice(0, 2),
                          )
                        }
                        placeholder="16"
                        inputMode="numeric"
                        aria-label="自定义比例宽"
                        data-testid={
                          testIdPrefix ? `${testIdPrefix}-custom-w` : undefined
                        }
                      />
                      <b>:</b>
                      <input
                        value={customHeight}
                        onChange={(event) =>
                          setCustomHeight(
                            event.target.value.replace(/\D/g, "").slice(0, 2),
                          )
                        }
                        placeholder="10"
                        inputMode="numeric"
                        aria-label="自定义比例高"
                        data-testid={
                          testIdPrefix ? `${testIdPrefix}-custom-h` : undefined
                        }
                      />
                    </label>
                    <Button
                      variant="secondary"
                      onClick={applyCustom}
                      disabled={!customWidth || !customHeight}
                      data-testid={
                        testIdPrefix
                          ? `${testIdPrefix}-custom-apply`
                          : undefined
                      }
                    >
                      应用
                    </Button>
                  </div>
                  {customTouched && !customValid ? (
                    <small>比例需在 1:4 与 4:1 之间</small>
                  ) : null}
                </div>
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
