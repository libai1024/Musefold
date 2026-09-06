// v2.5 桌面壳:设计方案宿主动作接缝(挂载切片 + Composer 运行切片)。
//
// onImportScheme 在 features 集成层刻意缺省(文件对话框 + staging 是宿主职责),
// 这里用已部署的桥方法组合:prepareImportPackage(主进程安全 staging,可取消)
// → importPackage(domain 导入,产出草稿)。
//
// Composer 运行缝(designSchemes.onRun / onCancelRun):renderer 只提交选择、文本值与执行设置,
// 主进程 prepareRun 从 exact revision / 来源绑定 / Provider 事实生成并校验 desktop-fixed-v1 计划,
// 再原样交给 run 执行到终态;取消按 executionId 经主进程执行注册表 fan-out。
// 参考图沿用普通生成的上传暂存通道:renderer 只提交暂存 id,主进程按方案图片槽位分配并在 run 前
// 解析为受管本地图;槽位数量不匹配由主进程 blocked 并解释,绝不静默丢弃用户输入。
//
// Agent 缝(designSchemes.onCreate / onModify):renderer 只交方案描述、GitHub 仓库地址、历史来源
// 身份或修改指令,主进程 Agent(Analyst / Compiler / Reviser)编译并落库;GitHub 来源由主进程
// 解析后发 confirmation-required,WorkbenchScreen 弹安装确认层再经 confirmInstall 送回决定。
// gateway 无 confirmInstall(旧桥)时 GitHub 地址在这里拒绝并解释,不静默安装。

import type {
  CreateDesignSchemeInput,
  ModifyDesignSchemeInput,
  PrepareDesignSchemeRunInput,
  RunResult,
} from '@musefold/contracts';
import type {
  SchemeComposerHandlers,
  SchemeCreateSubmission,
  SchemeModifySubmission,
  SchemeRunSubmission,
} from '@musefold/features/design-schemes';
import { queryKeys, usePlatform } from '@musefold/platform';
import { toast } from '@musefold/ui/components/sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef } from 'react';

/**
 * 「导入 .musefold.design」宿主动作:staging 被取消时静默返回;
 * 成功后失效方案列表缓存并 toast;任一步失败按 I4 toast 保留上下文。
 */
export function useImportDesignScheme(): () => void {
  const { gateway } = usePlatform();
  const queryClient = useQueryClient();

  return useCallback(() => {
    const designSchemes = gateway.designSchemes;
    const prepareImportPackage = designSchemes?.prepareImportPackage;
    if (!designSchemes || !prepareImportPackage) {
      toast.error('当前环境暂不支持导入方案', { description: '分享包 staging 通道不可用。' });
      return;
    }
    void (async () => {
      try {
        const prepared = await prepareImportPackage({});
        if (prepared.status === 'cancelled') return;
        const result = await designSchemes.importPackage({
          stagedPackageId: prepared.stagedPackageId,
          packageHash: prepared.packageHash,
          formatVersion: prepared.formatVersion,
        });
        await queryClient.invalidateQueries({ queryKey: queryKeys.designSchemes.all() });
        toast.success('已导入为草稿', {
          description: `「${result.scheme.name}」试运行通过并选封面后可设为正式。`,
        });
      } catch (error) {
        toast.error('导入方案失败', {
          description: error instanceof Error ? error.message : '分享包校验或导入失败',
        });
      }
    })();
  }, [gateway, queryClient]);
}

/**
 * 桌面固定计划接受文本与图片输入:Composer 参考图以上传暂存 id 提交,主进程 prepareRun 按声明顺序
 * 分配到图片槽位并在 run 前解析为受管本地图;槽位数量不匹配由主进程 blocked 并解释。
 */
export const DESKTOP_SCHEME_RUN_INPUT_SUPPORT = 'text-and-images' as const;

/**
 * Composer 运行提交 → 主进程 prepareRun 入参(严格 renderer 边界:无路径、无凭据、无计划字段)。
 * 抛出的 Error 消息直接作为 Composer 错误行文案(I4)。
 */
export function toDesktopPrepareRunInput(
  submission: SchemeRunSubmission,
): PrepareDesignSchemeRunInput {
  const { attachment } = submission;
  if (attachment.mode === 'modify') {
    throw new Error('修改要求不走运行管线');
  }
  if (!submission.providerId) {
    throw new Error('请先在设置中连接 AI 服务商');
  }
  // 参考图只交上传暂存 id(与普通生成同一通道);去重保序,路径与字节都不出 renderer。
  const referenceAssetIds = [...new Set(submission.referenceImages.map((image) => image.id))];
  return {
    executionId: submission.executionId,
    schemeId: attachment.schemeId,
    revisionId: attachment.revisionId,
    mode: attachment.mode,
    priorityMode: 'scheme_first',
    brief: submission.brief,
    inputValues: submission.inputValues,
    executionSettings: {
      providerId: submission.providerId,
      size: 'auto',
      ...(submission.params.aspectRatio ? { aspectRatio: submission.params.aspectRatio } : {}),
      quality: submission.params.quality,
      ...(submission.params.negative ? { negativePrompt: submission.params.negative } : {}),
      outputCount: 1,
      referenceAssetIds,
      promptReferenceSelections: submission.promptReferenceSelections,
      workbenchSessionId: submission.workbenchSessionId,
    },
  };
}

// 也匹配带 user:token@ 的形态,以便明确拒绝而不是当普通正文送给 Agent。
const GITHUB_URL_IN_TEXT = /https?:\/\/(?:[^\s/@]+@)?(?:www\.)?github\.com\/[^\s<>"'）)]+/gi;
const GITHUB_SEGMENT = /^[A-Za-z0-9_.-]+$/;
const MAX_GITHUB_SOURCES = 16;

/**
 * brief 里的 GitHub Skill 地址 → 仓库地址(承旧 parseDesignPlanBody + parseGithubSkillUrl):
 * 只接受不含凭据/查询参数的 github.com HTTPS 地址,`tree|blob/<ref>/<path>` 与 `.git` 归一为
 * `https://github.com/{owner}/{repo}`(主进程按仓库固定 commit 快照);正文剔除地址后压缩空白。
 * 不合法的 github.com 地址直接报错,不静默丢弃用户粘贴的来源。
 */
export function extractGithubSources(brief: string): { brief: string; sourceUris: string[] } {
  const matches = brief.match(GITHUB_URL_IN_TEXT) ?? [];
  const sourceUris: string[] = [];
  let text = brief;
  for (const raw of matches) {
    const candidate = raw.replace(/[.,;:!?，。；：！？]+$/u, '');
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      throw new Error('GitHub 地址格式不正确,请粘贴完整的仓库 HTTPS 地址');
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('GitHub 地址只支持不含凭据、查询参数和锚点的 https://github.com 仓库地址');
    }
    const [owner, repositoryRaw, routeKind] = url.pathname.split('/').filter(Boolean);
    const repository = repositoryRaw?.replace(/\.git$/i, '') ?? '';
    if (
      !owner ||
      !repository ||
      !GITHUB_SEGMENT.test(owner) ||
      !GITHUB_SEGMENT.test(repository) ||
      (routeKind !== undefined && routeKind !== 'tree' && routeKind !== 'blob')
    ) {
      throw new Error('GitHub 地址需要指向仓库首页,或仓库内的 tree / blob 路径');
    }
    const repositoryUrl = `https://github.com/${owner}/${repository}`;
    if (!sourceUris.includes(repositoryUrl)) sourceUris.push(repositoryUrl);
    // 只剔除地址本身,紧随的标点留在正文里。
    text = text.split(candidate).join(' ');
  }
  if (sourceUris.length > MAX_GITHUB_SOURCES) {
    throw new Error(`一次最多引入 ${MAX_GITHUB_SOURCES} 个 GitHub 来源`);
  }
  return { brief: text.replace(/\s+/g, ' ').trim(), sourceUris };
}

/**
 * Composer 创建提交 → 主进程 Agent 创建入参(严格 renderer 边界:无路径、无预解析来源)。
 * GitHub 来源需要宿主具备安装确认通道(confirmInstall);缺席时拒绝并解释,不静默安装。
 * 抛出的 Error 消息直接作为 Composer 错误行文案(I4)。
 */
export function toDesktopCreateInput(
  submission: SchemeCreateSubmission,
  options: { githubSources: boolean } = { githubSources: false },
): CreateDesignSchemeInput {
  const extracted = extractGithubSources(submission.brief.trim());
  if (extracted.sourceUris.length > 0 && !options.githubSources) {
    throw new Error('当前环境暂不支持从 GitHub 地址创建方案(缺少安装确认通道);请先描述方案想法。');
  }
  const brief = extracted.brief;
  const historySources =
    submission.source?.kind === 'history'
      ? submission.source.selection.items.map((item) => {
          if (!item.assetId) {
            throw new Error('所选历史作品缺少可用资产,请刷新后重新选择');
          }
          return { runId: item.jobId, assetId: item.assetId, includePrompt: item.prompt != null };
        })
      : [];
  if (!brief && extracted.sourceUris.length === 0 && historySources.length === 0) {
    throw new Error('请描述你的方案想法,或提供 GitHub Skill 地址 / 选择历史内容作为来源');
  }
  return {
    executionId: submission.executionId,
    brief,
    sourceUris: extracted.sourceUris,
    sourceBindings: [],
    sourcePackages: [],
    sourceSnapshots: [],
    sourceAssetIds: [],
    sourceAssets: [],
    historySources,
  };
}

/** Composer 修改提交 → 主进程 Agent 修改入参:基线锁定挂载附件的 exact revision。 */
export function toDesktopModifyInput(submission: SchemeModifySubmission): ModifyDesignSchemeInput {
  const instruction = submission.brief.trim();
  if (!instruction) throw new Error('请描述要修改的内容');
  return {
    executionId: submission.executionId,
    schemeId: submission.attachment.schemeId,
    baseRevisionId: submission.attachment.revisionId,
    instruction,
  };
}

/**
 * 工作台 Composer 方案接缝(桌面):
 * - onRun:prepareRun(主进程权威组装 + 校验)→ run(await 终态 RunResult);
 * - onCancelRun:cancel({ executionId }),already-terminal 视为成功(终态由 run 返回值裁决);
 * - onCreate / onModify:主进程 Agent 管线(Compiler / Reviser)编译并落库,成功后失效方案缓存;
 *   GitHub 地址在安装确认通道部署前于 renderer 侧拒绝并解释。
 * 主进程 prepareRun 缺席(旧桥)时整组运行缝缺省,Composer 按 I4 禁用并解释。
 */
export function useDesignSchemeComposerHandlers(): SchemeComposerHandlers {
  const { gateway } = usePlatform();
  const designSchemes = gateway.designSchemes;
  const prepareRun = designSchemes?.prepareRun;
  const queryClient = useQueryClient();
  const activeExecutions = useRef(new Set<string>());
  const cancelledExecutions = useRef(new Set<string>());

  return useMemo<SchemeComposerHandlers>(() => {
    if (!designSchemes) {
      return { runInputSupport: DESKTOP_SCHEME_RUN_INPUT_SUPPORT };
    }
    const refreshSchemes = () =>
      void queryClient.invalidateQueries({ queryKey: queryKeys.designSchemes.all() });
    // Agent 缝只依赖已部署的 create / modify;运行缝另需 prepareRun(旧桥缺席时整组缺省)。
    const agentHandlers: SchemeComposerHandlers = {
      runInputSupport: DESKTOP_SCHEME_RUN_INPUT_SUPPORT,
      onCreate: async (submission) => {
        const input = toDesktopCreateInput(submission, {
          githubSources: typeof designSchemes.confirmInstall === 'function',
        });
        try {
          await designSchemes.create(input);
        } finally {
          // 成功落草稿或失败(可能已固化历史快照)都刷方案列表,让方案中心与真实库一致。
          refreshSchemes();
        }
      },
      onModify: async (submission) => {
        const input = toDesktopModifyInput(submission);
        try {
          await designSchemes.modify(input);
        } finally {
          refreshSchemes();
        }
      },
    };
    if (!prepareRun) return agentHandlers;
    const refreshLedger = () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.generation.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.workbench.all() });
      refreshSchemes();
    };
    return {
      ...agentHandlers,
      onRun: async (submission): Promise<RunResult> => {
        const { executionId } = submission;
        activeExecutions.current.add(executionId);
        let runStarted = false;
        const unsubscribe = designSchemes.subscribeEvents((event) => {
          if (event.executionId !== executionId) return;
          refreshLedger();
        });
        try {
          const prepared = await prepareRun(toDesktopPrepareRunInput(submission));
          if (cancelledExecutions.current.has(executionId)) {
            throw new Error('方案运行已取消');
          }
          runStarted = true;
          return await designSchemes.run(prepared);
        } finally {
          unsubscribe();
          activeExecutions.current.delete(executionId);
          if (runStarted || cancelledExecutions.current.has(executionId)) refreshLedger();
          cancelledExecutions.current.delete(executionId);
        }
      },
      onCancelRun: async (executionId) => {
        if (!activeExecutions.current.has(executionId)) return;
        cancelledExecutions.current.add(executionId);
        try {
          await designSchemes.cancel({ executionId });
        } catch (error) {
          const code =
            error && typeof error === 'object' && 'code' in error ? error.code : undefined;
          if (code !== 'DESIGN_SCHEME_EXECUTION_NOT_FOUND') {
            cancelledExecutions.current.delete(executionId);
            throw error;
          }
        }
      },
    };
  }, [designSchemes, prepareRun, queryClient]);
}
