import {
  createContext,
  useContext,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { Switch } from '@musefold/ui';

function classes(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ');
}

/**
 * SettingsRow 为带 hint 的行提供 hint 元素 id，控件可消费它建立 aria-describedby 关联。
 * 行外渲染时为 undefined，控件不输出该属性（对既有用法零影响）。
 */
const SettingsRowHintContext = createContext<string | undefined>(undefined);

/** 当前 SettingsRow hint 的元素 id；供触发器类控件挂 aria-describedby。 */
export function useSettingsRowHintId(): string | undefined {
  return useContext(SettingsRowHintContext);
}

export interface SettingsSectionProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function SettingsSection({
  title,
  description,
  action,
  children,
  className,
}: SettingsSectionProps) {
  const headingId = useId();

  return (
    <section className={classes('mf-settings-section', className)} aria-labelledby={headingId}>
      <header className="mf-settings-section-header">
        <div className="mf-settings-section-heading-copy">
          <h1 id={headingId} className="mf-settings-section-title">
            {title}
          </h1>
          {description ? <p className="mf-settings-section-description">{description}</p> : null}
        </div>
        {action ? <div className="mf-settings-section-action">{action}</div> : null}
      </header>
      <div className="mf-settings-section-body">{children}</div>
    </section>
  );
}

export interface SettingsCardProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  testId?: string;
  'data-testid'?: string;
}

export function SettingsCard({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
  testId,
  'data-testid': dataTestId,
}: SettingsCardProps) {
  return (
    <section className={classes('mf-settings-card', className)} data-testid={testId ?? dataTestId}>
      <header className="mf-settings-card-header">
        <div className="mf-settings-card-heading-copy">
          <h2 className="mf-settings-card-title">{title}</h2>
          {description ? <p className="mf-settings-card-description">{description}</p> : null}
        </div>
        {action ? <div className="mf-settings-card-action">{action}</div> : null}
      </header>
      <div className={classes('mf-settings-card-body', bodyClassName)}>{children}</div>
    </section>
  );
}

export interface SettingsRowProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}

export function SettingsRow({ label, hint, children, className, ...props }: SettingsRowProps) {
  const hintId = useId();
  return (
    <div className={classes('mf-settings-row', className)} {...props}>
      <div className="mf-settings-row-copy">
        <div className="mf-settings-row-label">{label}</div>
        {hint ? (
          <div className="mf-settings-row-hint" id={hintId}>
            {hint}
          </div>
        ) : null}
      </div>
      <div className="mf-settings-row-control">
        <SettingsRowHintContext.Provider value={hint ? hintId : undefined}>
          {children}
        </SettingsRowHintContext.Provider>
      </div>
    </div>
  );
}

export interface SettingsSegmentedOption<T extends string | number> {
  value: T;
  label: string;
  icon?: ReactNode;
}

export function SettingsSegmentedControl<T extends string | number>({
  value,
  options,
  onChange,
  testIdPrefix,
  ariaLabel,
  className,
  disabled = false,
}: {
  value: T;
  options: readonly SettingsSegmentedOption<T>[];
  onChange: (value: T) => void;
  testIdPrefix?: string;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
}) {
  const hintId = useSettingsRowHintId();
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const hasCheckedOption = options.some((option) => option.value === value);

  // WAI-ARIA radio group：组内仅一个 tab stop，方向键/Home/End 漫游并选中。
  const selectOption = (index: number) => {
    const nextIndex = (index + options.length) % options.length;
    const option = options[nextIndex];
    optionRefs.current[nextIndex]?.focus();
    if (option && option.value !== value) onChange(option.value);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      selectOption(index + 1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      selectOption(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      selectOption(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      selectOption(options.length - 1);
    }
  };

  return (
    <div
      className={classes('mf-settings-segmented', className)}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-describedby={hintId}
    >
      {options.map((option, index) => {
        const active = option.value === value;
        return (
          <button
            type="button"
            role="radio"
            aria-checked={active}
            key={String(option.value)}
            ref={(element) => {
              optionRefs.current[index] = element;
            }}
            tabIndex={active || (!hasCheckedOption && index === 0) ? 0 : -1}
            onKeyDown={(event) => handleKeyDown(event, index)}
            onClick={() => {
              if (!active) onChange(option.value);
            }}
            disabled={disabled}
            data-testid={testIdPrefix ? `${testIdPrefix}-${String(option.value)}` : undefined}
            className="mf-settings-segmented-option"
          >
            {option.icon ? (
              <span className="mf-settings-segmented-icon" aria-hidden="true">
                {option.icon}
              </span>
            ) : null}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export interface SettingsSwitchProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onChange' | 'onClick'
> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  testId?: string;
}

export function SettingsSwitch({
  checked,
  onCheckedChange,
  label,
  testId,
  className,
  disabled,
  ...props
}: SettingsSwitchProps) {
  return (
    <Switch
      {...props}
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={label}
      title={label}
      disabled={disabled}
      data-testid={testId}
      className={classes('mf-settings-switch', className)}
    />
  );
}

export interface SettingsCheckboxProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'checked' | 'onChange' | 'type'
> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  testId?: string;
}

/** A compact settings checkbox whose label and description follow the shared row rhythm. */
export function SettingsCheckbox({
  checked,
  onCheckedChange,
  label,
  description,
  testId,
  className,
  disabled,
  ...props
}: SettingsCheckboxProps) {
  return (
    <label
      className={classes('mf-settings-checkbox', className)}
      data-disabled={disabled || undefined}
    >
      <input
        {...props}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        data-testid={testId}
        className="mf-settings-checkbox-input"
        onChange={(event) => onCheckedChange(event.target.checked)}
      />
      <span className="mf-settings-checkbox-copy">
        <span className="mf-settings-checkbox-label">{label}</span>
        {description ? (
          <span className="mf-settings-checkbox-description">{description}</span>
        ) : null}
      </span>
    </label>
  );
}
