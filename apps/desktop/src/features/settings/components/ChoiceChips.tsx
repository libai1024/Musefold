// 设置域统一的单选分段组；所有枚举选择共用尺寸、焦点和选中态。
import type { ComponentType } from 'react';
import { SettingsSegmentedControl } from '@musefold/product-ui';

export interface ChoiceChipOption<T extends string | number> {
  value: T;
  label: string;
  icon?: ComponentType<{ className?: string }>;
}

export function ChoiceChips<T extends string | number>({
  value,
  options,
  onChange,
  testIdPrefix,
  'aria-label': ariaLabel,
}: {
  value: T;
  options: ChoiceChipOption<T>[];
  onChange: (value: T) => void;
  testIdPrefix?: string;
  'aria-label'?: string;
}) {
  return (
    <SettingsSegmentedControl
      value={value}
      options={options.map((option) => {
        const Icon = option.icon;
        return {
          value: option.value,
          label: option.label,
          icon: Icon ? <Icon className="h-3.5 w-3.5" /> : undefined,
        };
      })}
      onChange={onChange}
      testIdPrefix={testIdPrefix}
      ariaLabel={ariaLabel}
    />
  );
}
