/**
 * 受控草稿表单的纯逻辑，供 `useDraftForm` 绑定，也便于单测（product-ui 无 DOM 测试环境，
 * 一律把语义放在纯函数里）。
 */

export type DraftErrors<TField extends string> = Partial<Record<TField, string>>;
export type DraftTouched<TField extends string> = Partial<Record<TField, boolean>>;

/** 只在字段被碰过之后才吐错误，避免打开表单就满屏红字。 */
export function visibleError<TField extends string>(
  errors: DraftErrors<TField>,
  touched: DraftTouched<TField>,
  field: TField,
): string | undefined {
  return touched[field] ? errors[field] : undefined;
}

/** 提交路径一次点亮全部字段。 */
export function allTouched<TField extends string>(
  fields: readonly TField[],
): DraftTouched<TField> {
  return Object.fromEntries(fields.map((field) => [field, true])) as DraftTouched<TField>;
}

export function isDraftValid<TField extends string>(errors: DraftErrors<TField>): boolean {
  return Object.keys(errors).length === 0;
}

/** 逐值比较：改回原值即不脏，宿主换 `initial` 后自动归位。 */
export function isDraftDirty<TDraft>(draft: TDraft, initial: TDraft): boolean {
  return JSON.stringify(draft) !== JSON.stringify(initial);
}
