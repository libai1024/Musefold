import {
  useId,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';

function classes(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ');
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
  return (
    <div className={classes('mf-settings-row', className)} {...props}>
      <div className="mf-settings-row-copy">
        <div className="mf-settings-row-label">{label}</div>
        {hint ? <div className="mf-settings-row-hint">{hint}</div> : null}
      </div>
      <div className="mf-settings-row-control">{children}</div>
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
  return (
    <div
      className={classes('mf-settings-segmented', className)}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            type="button"
            role="radio"
            aria-checked={active}
            key={String(option.value)}
            onClick={() => onChange(option.value)}
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
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      data-testid={testId}
      data-checked={checked || undefined}
      className={classes('mf-settings-switch', className)}
      onClick={() => onCheckedChange(!checked)}
      {...props}
    >
      <span className="mf-settings-switch-thumb" aria-hidden="true" />
    </button>
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
