// src/stores/toast.ts
// 全局 toast 队列 —— 供任意 store/组件在无 React 上下文时调用
// 详见 docs/product/10-library-deep-dive.md §4.3（删除后 5s 内可撤销）

import { create } from 'zustand';

export type ToastVariant = 'default' | 'success' | 'danger' | 'warning' | 'accent';

export interface ToastAction {
  label: string;
  /** 点击后自动关闭该 toast */
  onClick: () => void;
}

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
  /** 毫秒；0 = 不自动关闭 */
  duration: number;
  action?: ToastAction;
}

export interface ToastInput {
  title: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
  action?: ToastAction;
}

interface ToastState {
  toasts: ToastItem[];
  push: (t: ToastInput) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

let seq = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => {
    const id = `t${Date.now().toString(36)}-${(seq++).toString(36)}`;
    const item: ToastItem = {
      id,
      title: t.title,
      description: t.description,
      variant: t.variant ?? 'default',
      duration: t.duration ?? 3500,
      action: t.action,
    };
    // 最多同时 4 条，超出丢最旧的
    set((s) => ({ toasts: [...s.toasts, item].slice(-4) }));
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

/** store / 非组件代码里直接用的快捷入口 */
export const toast = {
  show: (t: ToastInput) => useToastStore.getState().push(t),
  success: (title: string, description?: string) =>
    useToastStore.getState().push({ title, description, variant: 'success' }),
  error: (title: string, description?: string) =>
    useToastStore.getState().push({ title, description, variant: 'danger', duration: 6000 }),
  info: (title: string, description?: string) =>
    useToastStore.getState().push({ title, description }),
  dismiss: (id: string) => useToastStore.getState().dismiss(id),
};
