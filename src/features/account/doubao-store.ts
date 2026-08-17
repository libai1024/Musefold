import { create } from 'zustand';
import type { DoubaoWebAccountStatus, DoubaoWebUsageStatus } from '@shared/types/providers';
import api from '../../lib/ipc';

interface DoubaoAccountState {
  status: DoubaoWebAccountStatus | null;
  loading: boolean;
  error: string | null;
  refreshStatus: () => Promise<DoubaoWebAccountStatus>;
  refreshUsage: () => Promise<DoubaoWebUsageStatus>;
}

let statusRequest: Promise<DoubaoWebAccountStatus> | null = null;
let usageRequest: Promise<DoubaoWebUsageStatus> | null = null;
let loginEventsBound = false;

export const useDoubaoAccountStore = create<DoubaoAccountState>((set) => ({
  status: null,
  loading: false,
  error: null,

  refreshStatus: async () => {
    if (statusRequest) return statusRequest;
    set({ loading: true, error: null });
    statusRequest = api.provider.webStatus()
      .then((status) => {
        set({ status, loading: false, error: null });
        return status;
      })
      .catch((error) => {
        set({
          loading: false,
          error: error instanceof Error ? error.message : '豆包账号状态读取失败',
        });
        throw error;
      })
      .finally(() => {
        statusRequest = null;
      });
    return statusRequest;
  },

  refreshUsage: async () => {
    if (usageRequest) return usageRequest;
    usageRequest = api.provider.webUsage()
      .then((usage) => {
        set((state) => ({
          status: state.status
            ? { ...state.status, usage }
            : {
                loggedIn: false,
                accountName: null,
                avatarDataUrl: null,
                verificationRequired: false,
                usage,
              },
          error: null,
        }));
        return usage;
      })
      .catch((error) => {
        set({ error: error instanceof Error ? error.message : '豆包剩余次数读取失败' });
        throw error;
      })
      .finally(() => {
        usageRequest = null;
      });
    return usageRequest;
  },
}));

if (typeof window !== 'undefined' && !loginEventsBound) {
  loginEventsBound = true;
  const onWebLoginChanged = api.provider?.onWebLoginChanged;
  if (onWebLoginChanged) {
    onWebLoginChanged((status) => {
      useDoubaoAccountStore.setState({ status, loading: false, error: status.errorMessage ?? null });
    });
  }
}
