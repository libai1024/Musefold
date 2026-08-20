/**
 * 创建设计方案（v0.3.2 创建切片）的 renderer 门面。
 *
 * 职责：把主进程创建管线（designScheme:*）接到工作台对话轮——
 * 发起创建、转发事件为对话轨迹、承接安装确认与取消。
 * 方案数据本体由主进程写入新 design-scheme 库，这里不持久化任何内容。
 */
import { create } from 'zustand';
import { desktopHost as api } from '@renderer/runtime/desktop-host-services';
import type {
  DesignSchemeCreationEvent,
  DesignSchemeHistorySourceItem,
  DesignSchemeSummary,
} from '@musefold/desktop-contracts/design-scheme';
import { toast } from '../../stores/toast';
import { useAppStore } from '../../stores/app';
import { useGenerationWorkbenchStore } from '../generation/workbench/store';
import type { GenerationSource } from '../generation/workbench/types';
import { repositoryLabel } from './sourceLabel';

type SchemeAttachmentSource = Extract<GenerationSource, { kind: 'scheme' }>;

interface SchemeCreationState {
  creating: boolean;
  executionId: string | null;
  turnId: string | null;
  /** 正在进行的是创建还是修改（取消时走不同通道）。 */
  activeKind: 'create' | 'modify' | null;
  awaitingConfirmation: boolean;
  /** 想法、可选 GitHub Skill 地址（多个则合并编译）与可选历史来源启动创建；返回是否成功发起。 */
  start: (
    brief: string,
    githubUrls?: string[],
    history?: { items: DesignSchemeHistorySourceItem[] },
  ) => Promise<boolean>;
  /** 把方案挂载为「修改方案」附件（UI 规范 §8.3），并切到工作台。 */
  attachModify: (schemeId: string) => Promise<boolean>;
  /** 发送一条修改要求：Agent 更新草稿 / 为正式方案产出待验证新版本。 */
  startModify: (source: SchemeAttachmentSource, instruction: string) => Promise<boolean>;
  /** 响应对话内的安装确认卡片。 */
  confirmInstall: (accept: boolean) => Promise<void>;
  cancel: () => Promise<void>;
}

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export const useSchemeCreationStore = create<SchemeCreationState>((set, get) => ({
  creating: false,
  executionId: null,
  turnId: null,
  activeKind: null,
  awaitingConfirmation: false,

  start: async (brief, githubUrls, history) => {
    if (get().creating) return false;
    const workbench = useGenerationWorkbenchStore.getState();
    const executionId = uid('dscreate');
    const historyCount = history?.items.length ?? 0;
    const urls = (githubUrls ?? []).filter(Boolean);
    const begin = workbench.beginSchemeCreationTurn({
      brief,
      executionId,
      label: urls.length > 0
        ? urls.length > 1
          ? `${repositoryLabel(urls[0])} 等 ${urls.length} 个来源`
          : repositoryLabel(urls[0])
        : historyCount > 0
          ? `历史 · ${historyCount} 张图片`
          : '创建设计方案',
      ...(urls[0] ? { githubUrl: urls[0] } : {}),
    });
    if (!begin) return false;
    set({ creating: true, executionId, turnId: begin.turnId, activeKind: 'create', awaitingConfirmation: false });

    try {
      const result = await api.designScheme.startCreation({
        executionId,
        brief,
        ...(urls[0] ? { githubUrl: urls[0] } : {}),
        ...(urls.length > 1 ? { githubUrls: urls } : {}),
        ...(historyCount > 0 && history ? { history: { items: history.items.map((item) => ({ ...item })) } } : {}),
      });
      const state = useGenerationWorkbenchStore.getState();
      if (result.ok) {
        state.completeSchemeCreationTurn(
          begin.turnId,
          { ...result.data.scheme, creationSummary: result.data.creationSummary },
          result.data.trace,
        );
      } else {
        state.failSchemeCreationTurn(
          begin.turnId,
          result.error.message,
          result.error.code === 'CANCELLED',
        );
      }
      return result.ok;
    } catch (error) {
      const message = error instanceof Error ? error.message : '创建设计方案失败';
      useGenerationWorkbenchStore.getState().failSchemeCreationTurn(begin.turnId, message);
      return false;
    } finally {
      set({ creating: false, executionId: null, turnId: null, activeKind: null, awaitingConfirmation: false });
    }
  },

  attachModify: async (schemeId) => {
    // 详情页等入口可能拿着过期摘要；修改基线总是取最新（正式方案优先接续待验证草稿）。
    const summaries = await api.designScheme.list();
    const latest: DesignSchemeSummary | undefined = summaries.ok
      ? summaries.data.find((item) => item.id === schemeId)
      : undefined;
    if (!latest) {
      toast.error('无法打开方案', summaries.ok ? '方案不存在或已被移除' : summaries.error.message);
      return false;
    }
    const baseRevisionId = latest.status === 'formal' && latest.workingDraftRevisionId
      ? latest.workingDraftRevisionId
      : latest.currentRevisionId;
    const revision = await api.designScheme.getRevision(baseRevisionId);
    if (!revision.ok) {
      toast.error('无法打开方案', revision.error.message);
      return false;
    }
    useGenerationWorkbenchStore.getState().setDraftSource({
      kind: 'scheme',
      schemeId: latest.id,
      revisionId: baseRevisionId,
      label: revision.data.name,
      summary: revision.data.summary,
      mode: 'modify',
      fidelity: latest.fidelity,
      sourceLabel: latest.sourceLabel,
      // 修改模式不显示运行变量（规范 §8.3）；输入槽位留空。
      inputs: [],
      coverAssetId: latest.coverAssetId,
      hasSuccessfulTrial: latest.hasSuccessfulTrial,
    });
    useGenerationWorkbenchStore.setState({ schemeInputValues: {} });
    useAppStore.getState().setView('generate');
    return true;
  },

  startModify: async (source, instruction) => {
    if (get().creating) return false;
    const workbench = useGenerationWorkbenchStore.getState();
    const executionId = uid('dsmodify');
    const begin = workbench.beginSchemeCreationTurn({
      brief: instruction,
      executionId,
      label: `修改方案 · ${source.label}`,
    });
    if (!begin) return false;
    set({ creating: true, executionId, turnId: begin.turnId, activeKind: 'modify', awaitingConfirmation: false });

    try {
      const result = await api.designScheme.startModify({
        executionId,
        schemeId: source.schemeId,
        baseRevisionId: source.revisionId,
        instruction,
      });
      const state = useGenerationWorkbenchStore.getState();
      if (result.ok) {
        state.completeSchemeCreationTurn(
          begin.turnId,
          { ...result.data.scheme, creationSummary: result.data.creationSummary },
          result.data.trace,
        );
        // 附件跟进到新版本：下一轮修改在最新草稿之上（§8.3 每轮更新同一份草稿）。
        const revision = await api.designScheme.getRevision(result.data.revisionId);
        const current = useGenerationWorkbenchStore.getState().draftSource;
        if (current.kind === 'scheme' && current.mode === 'modify' && current.schemeId === source.schemeId) {
          useGenerationWorkbenchStore.getState().setDraftSource({
            ...current,
            revisionId: result.data.revisionId,
            ...(revision.ok ? { label: revision.data.name, summary: revision.data.summary } : {}),
          });
        }
      } else {
        state.failSchemeCreationTurn(
          begin.turnId,
          result.error.message,
          result.error.code === 'CANCELLED',
        );
      }
      return result.ok;
    } catch (error) {
      const message = error instanceof Error ? error.message : '修改设计方案失败';
      useGenerationWorkbenchStore.getState().failSchemeCreationTurn(begin.turnId, message);
      return false;
    } finally {
      set({ creating: false, executionId: null, turnId: null, activeKind: null, awaitingConfirmation: false });
    }
  },

  confirmInstall: async (accept) => {
    const { executionId, turnId } = get();
    if (!executionId) return;
    set({ awaitingConfirmation: false });
    if (turnId) {
      useGenerationWorkbenchStore.getState().patchSchemeCreationSource(turnId, { confirmation: undefined });
    }
    await api.designScheme.confirmInstall(executionId, accept).catch(() => undefined);
  },

  cancel: async () => {
    const { executionId, activeKind } = get();
    if (!executionId) return;
    if (activeKind === 'modify') await api.designScheme.cancelModify(executionId).catch(() => undefined);
    else await api.designScheme.cancelCreation(executionId).catch(() => undefined);
  },
}));

// 主进程创建事件 → 对话轮轨迹（状态机、步骤、安装确认、草稿就绪）。
if (typeof api.designScheme?.onEvent === 'function') {
  api.designScheme.onEvent((event: DesignSchemeCreationEvent) => {
    const state = useSchemeCreationStore.getState();
    if (!state.executionId || event.executionId !== state.executionId || !state.turnId) return;
    const workbench = useGenerationWorkbenchStore.getState();
    switch (event.kind) {
      case 'state':
        workbench.patchSchemeCreationSource(state.turnId, { state: event.state });
        break;
      case 'trace':
        workbench.upsertSchemeCreationTrace(state.turnId, event.item);
        break;
      case 'confirmation-required':
        useSchemeCreationStore.setState({ awaitingConfirmation: true });
        workbench.patchSchemeCreationSource(state.turnId, { confirmation: event.source });
        break;
      case 'draft-ready':
        // 终态由 startCreation 的返回统一收尾；这里提前挂上草稿供 UI 渲染。
        workbench.patchSchemeCreationSource(state.turnId, {
          draft: { ...event.result.scheme, creationSummary: event.result.creationSummary },
        });
        break;
      default:
        break;
    }
  });
}
