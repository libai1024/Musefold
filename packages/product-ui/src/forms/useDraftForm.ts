import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  allTouched,
  isDraftDirty,
  isDraftValid,
  visibleError,
  type DraftErrors,
  type DraftTouched,
} from './draftFormState';

/**
 * 受控草稿表单的通用形态：草稿对象 + touched + 纯函数校验。
 *
 * 这是全仓表单的既定范式（开发规范 §3.2）。对话框类表单的复杂度集中在异步副作用
 * （拉模型列表、测连接、写系统钥匙串）而不是字段校验，字段部分保持受控草稿即可，
 * 不引入表单库。
 *
 * `validate` 每次渲染都可以传新函数，内部按 ref 取最新实现，只在草稿变化时重算。
 */
export interface DraftFormOptions<TDraft, TField extends string> {
  initial: TDraft;
  validate: (draft: TDraft) => DraftErrors<TField>;
}

export interface DraftForm<TDraft, TField extends string> {
  draft: TDraft;
  setDraft: (updater: TDraft | ((current: TDraft) => TDraft)) => void;
  /** 改单个字段，等价于 setDraft 展开赋值。 */
  setField: <TKey extends keyof TDraft>(key: TKey, value: TDraft[TKey]) => void;
  errors: DraftErrors<TField>;
  errorFor: (field: TField) => string | undefined;
  touched: DraftTouched<TField>;
  markTouched: (field: TField) => void;
  touchAll: (fields: readonly TField[]) => void;
  valid: boolean;
  dirty: boolean;
  reset: () => void;
  /** 把当前草稿标记为新基线（dirty 归零、touched 清空）。
   *  用于「草稿已被隐式落库」场景：落库内容即当前表单值，后续修改才算 dirty。 */
  markPristine: () => void;
}

export function useDraftForm<TDraft extends object, TField extends string>({
  initial,
  validate,
}: DraftFormOptions<TDraft, TField>): DraftForm<TDraft, TField> {
  const [draft, setDraft] = useState<TDraft>(initial);
  const [touched, setTouched] = useState<DraftTouched<TField>>({});
  const initialRef = useRef(initial);
  const validateRef = useRef(validate);
  validateRef.current = validate;

  useEffect(() => {
    setDraft(initial);
    initialRef.current = initial;
    setTouched({});
  }, [initial]);

  const errors = useMemo(() => validateRef.current(draft), [draft]);

  const setField = useCallback(
    <TKey extends keyof TDraft>(key: TKey, value: TDraft[TKey]) => {
      setDraft((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const markTouched = useCallback((field: TField) => {
    setTouched((current) => ({ ...current, [field]: true }));
  }, []);

  const touchAll = useCallback((fields: readonly TField[]) => {
    setTouched(allTouched(fields));
  }, []);

  const reset = useCallback(() => {
    setDraft(initialRef.current);
    setTouched({});
  }, []);

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const markPristine = useCallback(() => {
    initialRef.current = draftRef.current;
    setTouched({});
  }, []);

  return {
    draft,
    setDraft,
    setField,
    errors,
    errorFor: (field) => visibleError(errors, touched, field),
    touched,
    markTouched,
    touchAll,
    valid: isDraftValid(errors),
    dirty: isDraftDirty(draft, initialRef.current),
    reset,
    markPristine,
  };
}
