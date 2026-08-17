// src/features/library/hooks/useDebounce.ts
// 150ms 防抖 —— 详见 docs/03-prompt-library.md §2.1

import { useEffect, useState } from 'react';
import { SEARCH_DEBOUNCE_MS } from '@shared/constants';

export function useDebounce<T>(value: T, delay: number = SEARCH_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
