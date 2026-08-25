// src/features/generation/store.ts
// Provider 配置状态 —— Provider 生命周期、密钥、模型和连通性测试。
//
// 生成草稿、回合、取消和重试统一由 generation/workbench/store 管理；
// 这里不再保留旧的精修生成兼容状态，避免出现多个状态源。

import { create } from 'zustand';
import type {
  ProviderConfig,
  NewProviderConfig,
  ModelInfo,
  ValidationResult,
} from '@musefold/desktop-contracts/providers';
import type { AutomationProviderDraft } from '@musefold/desktop-contracts/ipc';
import { gateway } from '../../runtime/gateway-context';

/** 单个 Provider 的连通性测试状态 */
export type ProviderTestState = 'idle' | 'testing' | 'ok' | 'failed' | 'skipped';
export interface ProviderTest {
  state: ProviderTestState;
  message?: string;
  /** 归一化错误码（failed 时），供错误分类引导 */
  code?: string;
}

interface GenerationState {
  providers: ProviderConfig[];
  /** 首次 loadProviders() 是否已落定（成功或失败都算）—— 供首启引导判断前避免闪烁 */
  providersLoaded: boolean;
  activeProviderId: string | null;
  /** Provider 配置浮层开关（全局，供标题栏/侧栏/设置页共同驱动） */
  providerDialogOpen: boolean;
  /** 浮层正在编辑的 Provider（null=新建） */
  editingProvider: ProviderConfig | null;
  /** 新建时预选的接入预设 id（空态一键接入用，TASK-GEN-01） */
  dialogPresetId: string | null;
  /** 自动化入口只可传入非敏感预填项；API Key 永不进入 store。 */
  dialogDraft: AutomationProviderDraft | null;
  /** 各 Provider 连通性测试状态（按 id 索引） */
  testStatus: Record<string, ProviderTest>;

  setProviderDialogOpen: (open: boolean) => void;
  /** 打开浮层：不传=新建，传 provider=编辑；opts.presetId 指定新建时预填的预设 */
  openProviderDialog: (
    provider?: ProviderConfig | null,
    opts?: { presetId?: string; draft?: AutomationProviderDraft },
  ) => void;
  loadProviders: () => Promise<void>;
  createProvider: (p: NewProviderConfig) => Promise<ProviderConfig>;
  updateProvider: (id: string, patch: Partial<NewProviderConfig>) => Promise<void>;
  deleteProvider: (id: string) => Promise<void>;
  saveKey: (id: string, apiKey: string) => Promise<void>;
  setActive: (id: string) => Promise<void>;
  validate: (id: string) => Promise<ValidationResult>;
  listModels: (id: string) => Promise<ModelInfo[]>;
  /** 测试单个 Provider 的连通性，并把结果写入 testStatus */
  testProvider: (id: string) => Promise<ProviderTest>;
}

export const useGenerationStore = create<GenerationState>((set, get) => ({
  providers: [],
  providersLoaded: false,
  activeProviderId: null,
  providerDialogOpen: false,
  editingProvider: null,
  dialogPresetId: null,
  dialogDraft: null,
  testStatus: {},

  setProviderDialogOpen: (open) =>
    set(
      open
        ? { providerDialogOpen: true }
        : { providerDialogOpen: false, editingProvider: null, dialogPresetId: null, dialogDraft: null },
    ),
  openProviderDialog: (provider, opts) => {
    if (provider?.managedBy === 'account') return;
    set({
      providerDialogOpen: true,
      editingProvider: provider ?? null,
      // 编辑已有条目时忽略预设；新建才带 preset 预填
      dialogPresetId: provider ? null : (opts?.presetId ?? null),
      dialogDraft: provider ? null : (opts?.draft ?? null),
    });
  },

  loadProviders: async () => {
    try {
      const list = await gateway.desktop.listProviders();
      const active = list.find((p) => p.isActive) ?? list[0] ?? null;
      set({ providers: list, activeProviderId: active?.id ?? null, providersLoaded: true });
    } catch (err) {
      set({ providersLoaded: true });
      throw err;
    }
  },

  createProvider: async (p) => {
    const created = await gateway.desktop.createProvider(p);
    set((s) => ({ providers: [...s.providers, created] }));
    if (created.isActive) set({ activeProviderId: created.id });
    return created;
  },

  updateProvider: async (id, patch) => {
    if (get().providers.find((provider) => provider.id === id)?.managedBy === 'account') {
      throw new Error('账号生图模型由 Musefold 固定管理');
    }
    const updated = await gateway.desktop.updateProvider(id, patch);
    set((s) => ({ providers: s.providers.map((p) => (p.id === id ? updated : p)) }));
  },

  deleteProvider: async (id) => {
    await gateway.desktop.deleteProvider(id);
    set((s) => ({
      providers: s.providers.filter((p) => p.id !== id),
      activeProviderId: s.activeProviderId === id ? null : s.activeProviderId,
    }));
  },

  saveKey: async (id, apiKey) => {
    await gateway.desktop.saveProviderKey(id, apiKey);
    const { hasKey, suffix } = await gateway.desktop.hasProviderKey(id);
    set((s) => ({
      providers: s.providers.map((p) =>
        p.id === id ? { ...p, hasKey, keySuffix: suffix } : p
      ),
    }));
  },

  setActive: async (id) => {
    await gateway.desktop.setActiveProvider(id);
    set({ activeProviderId: id });
    await get().loadProviders();
  },

  validate: async (id) => {
    return gateway.desktop.validateProvider(id);
  },

  listModels: async (id) => gateway.desktop.listProviderModels(id),

  testProvider: async (id) => {
    const provider = get().providers.find((p) => p.id === id);
    // 无密钥直接跳过，避免必然失败的网络请求
    if (provider && !provider.hasKey && provider.type !== 'doubao-web') {
      const skipped: ProviderTest = { state: 'skipped', message: '未配置密钥', code: 'NO_KEY' };
      set((s) => ({ testStatus: { ...s.testStatus, [id]: skipped } }));
      return skipped;
    }
    set((s) => ({ testStatus: { ...s.testStatus, [id]: { state: 'testing' } } }));
    try {
      const res = await gateway.desktop.validateProvider(id);
      if (provider?.type === 'doubao-web') await get().loadProviders();
      const result: ProviderTest = {
        state: res.ok ? 'ok' : 'failed',
        message: res.message,
        code: res.code,
      };
      set((s) => ({ testStatus: { ...s.testStatus, [id]: result } }));
      return result;
    } catch (err) {
      const result: ProviderTest = {
        state: 'failed',
        message: (err as Error)?.message ?? '连接失败',
        code: 'UNKNOWN',
      };
      set((s) => ({ testStatus: { ...s.testStatus, [id]: result } }));
      return result;
    }
  },

}));
