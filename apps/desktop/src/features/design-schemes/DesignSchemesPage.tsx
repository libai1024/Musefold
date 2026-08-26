import { useEffect, useMemo, useState } from 'react';
import { Blocks, GitBranch, Search, Trash2 } from '../../components/ui/icons';
import { cn } from '../../lib/utils';
import { toImageSrc } from '../../lib/media';
import { useAppStore } from '../../stores/app';
import { toast } from '../../stores/toast';
import { desktopHost as api } from '@renderer/runtime/desktop-host-services';
import type {
  DesignSchemeSummary,
  MarketCandidate,
  MarketSearchResult,
} from '@musefold/desktop-contracts/design-scheme';
import { useGenerationWorkbenchStore } from '@renderer/runtime/workbench-access';
import { useSchemeCreationStore } from './creation-store';
import { useSchemeRunStore } from './run-store';
import { SchemeRuntimeDetail } from './SchemeRuntimeDetail';
import { SchemeInspector } from './SchemeInspector';
import {
  MarketCandidateRow,
  MarketInstallDialog,
  SchemeListRemoveDialog,
  type SchemeCreateKind,
} from './SchemeListActions';
import { SchemeListSection } from './SchemeListPrimitives';
import { HistorySourcePicker } from './HistorySourcePicker';
import { SchemeControlDeck, type SchemeSurface } from './SchemeControlDeck';

const RUNTIME_FIDELITY_LABEL: Record<string, string> = {
  verified: '已验证',
  faithful: '完整还原',
  adapted: '有取舍',
  unsupported: '暂不支持',
};

/** 行尾悬停出现的删除入口（UI 规范 §3.3：危险操作不常驻，确认后执行）。 */
function RowRemoveButton({
  label,
  onRemove,
  testId,
}: {
  label: string;
  onRemove: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onRemove();
      }}
      className="no-drag flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-tertiary opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/30 group-hover:opacity-100"
      aria-label={label}
      title={label}
      data-testid={testId}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  );
}

/** 存于新 design-scheme 库的真实方案行：点行进详情，行尾按钮只执行动作（UI 规范 §3.3）。 */
function RuntimeSchemeRow({
  scheme,
  selected,
  onOpen,
  onRun,
  onRemove,
}: {
  scheme: DesignSchemeSummary;
  selected: boolean;
  onOpen: () => void;
  onRun: () => void;
  onRemove: () => void;
}) {
  const actionLabel =
    scheme.status === 'formal' ? '使用' : scheme.hasSuccessfulTrial ? '继续' : '试运行';
  return (
    <article
      className={cn(
        'group grid min-h-[76px] grid-cols-[56px_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-md border px-2 py-2 transition-colors',
        selected ? 'border-accent/15 bg-accent-soft' : 'border-transparent hover:bg-hover',
      )}
      data-testid={`runtime-scheme-row-${scheme.id}`}
      data-runtime-scheme="true"
      data-status={scheme.status}
      data-selected={selected}
    >
      <button
        type="button"
        onClick={onOpen}
        className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        aria-label={`查看${scheme.name}`}
      >
        {scheme.coverImagePath ? (
          <span className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-md border border-border-subtle bg-inset/55">
            <img
              src={toImageSrc(scheme.coverImagePath)}
              alt=""
              className="h-full w-full object-contain"
            />
          </span>
        ) : (
          <span
            className="flex h-14 w-14 items-center justify-center rounded-md border border-border-subtle bg-accent-soft text-accent"
            aria-hidden
          >
            <Blocks className="h-5 w-5" />
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 text-left focus-visible:outline-none"
        data-testid={`runtime-scheme-open-${scheme.id}`}
      >
        <span className="flex min-w-0 items-center gap-2">
          {scheme.status === 'draft' && !scheme.hasSuccessfulTrial && (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
          )}
          <span className="truncate text-[12.5px] font-semibold text-primary">{scheme.name}</span>
          <span className="shrink-0 rounded-full border border-border-subtle px-1.5 py-0.5 text-meta text-secondary">
            {RUNTIME_FIDELITY_LABEL[scheme.fidelity] ?? scheme.fidelity}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-meta text-secondary">{scheme.summary}</span>
        <span className="mt-0.5 flex items-center gap-1.5 truncate text-meta text-tertiary">
          <GitBranch className="h-3 w-3 shrink-0" />
          {scheme.sourceLabel}
          {scheme.status === 'draft' && (
            <span>· {scheme.hasSuccessfulTrial ? '已有成功试运行' : '等待试运行'}</span>
          )}
          {scheme.inputLabels.length > 0 && <span>· 输入:{scheme.inputLabels.join('、')}</span>}
        </span>
      </button>
      <RowRemoveButton
        label={scheme.status === 'draft' ? '删除草稿' : '移除方案'}
        onRemove={onRemove}
        testId={`runtime-scheme-remove-${scheme.id}`}
      />
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onRun();
        }}
        className="no-drag min-h-8 shrink-0 rounded-md px-2.5 text-[11px] font-medium text-primary transition-colors hover:bg-pressed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        data-testid={`runtime-scheme-action-${scheme.id}`}
      >
        {actionLabel}
      </button>
    </article>
  );
}

function EmptyList({ surface }: { surface: SchemeSurface }) {
  return (
    <div className="col-span-full py-16 text-center">
      <Search className="mx-auto h-5 w-5 text-quaternary" />
      <p className="mt-3 text-[12px] text-secondary">
        没有找到匹配的{surface === 'mine' ? '方案' : '结果'}
      </p>
      <p className="mt-1 text-meta text-tertiary">换一个名称、作者或仓库地址试试</p>
    </div>
  );
}

export function DesignSchemesPage() {
  const setView = useAppStore((state) => state.setView);
  const [surface, setSurface] = useState<SchemeSurface>('mine');
  const [query, setQuery] = useState('');
  const [historySourceOpen, setHistorySourceOpen] = useState(false);
  const [runtimeSchemes, setRuntimeSchemes] = useState<DesignSchemeSummary[]>([]);
  const [selectedSchemeId, setSelectedSchemeId] = useState<string | null>(null);
  const [runtimeDetailId, setRuntimeDetailId] = useState<string | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  // 市场搜索（Explorer）：只在用户显式发起时请求，不自动加载远程列表。
  const [marketResult, setMarketResult] = useState<MarketSearchResult | null>(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [installCandidate, setInstallCandidate] = useState<MarketCandidate | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{
    id: string;
    name: string;
    isDraft: boolean;
  } | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const attachSchemeRun = useSchemeRunStore((state) => state.attach);
  const loadRuntimeSchemes = async () => {
    setRuntimeLoading(true);
    setRuntimeError(null);
    try {
      const result = await api.designScheme.list();
      if (result.ok) {
        setRuntimeSchemes(result.data);
      } else {
        setRuntimeError(result.error.message);
      }
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : '读取设计方案失败');
    } finally {
      setRuntimeLoading(false);
    }
  };

  // 导入 .musefold.design 分享包（设计规范 §7）：校验后生成新草稿并直达详情。
  const importSharePackage = async () => {
    const result = await api.designScheme.importScheme();
    if (!result.ok) {
      toast.error('导入失败', result.error.message);
      return;
    }
    if (result.data.cancelled || !result.data.scheme) return;
    const scheme = result.data.scheme;
    setRuntimeSchemes((prev) => [scheme, ...prev.filter((item) => item.id !== scheme.id)]);
    setSurface('mine');
    setRuntimeDetailId(scheme.id);
    toast.success('分享包已导入', '已生成方案草稿；完成一次本机试运行后可设为正式。');
  };
  const normalized = query.trim().toLowerCase();
  const filteredRuntimeSchemes = useMemo(
    () =>
      runtimeSchemes.filter(
        (scheme) =>
          !normalized ||
          [scheme.name, scheme.summary, scheme.sourceLabel]
            .join(' ')
            .toLowerCase()
            .includes(normalized),
      ),
    [normalized, runtimeSchemes],
  );
  const runtimeDrafts = filteredRuntimeSchemes.filter((scheme) => scheme.status === 'draft');
  const runtimeFormal = filteredRuntimeSchemes.filter((scheme) => scheme.status === 'formal');
  const showRuntimeGroupHeadings = runtimeDrafts.length > 0 && runtimeFormal.length > 0;
  const mineEmpty = filteredRuntimeSchemes.length === 0;
  const runRuntimeScheme = (scheme: DesignSchemeSummary) => {
    void attachSchemeRun(scheme, scheme.status === 'formal' ? 'formal' : 'trial');
  };

  const confirmRemove = async () => {
    if (!removeTarget || removeBusy) return;
    setRemoveBusy(true);
    try {
      const result = await api.designScheme.remove(removeTarget.id);
      if (!result.ok) {
        toast.error(removeTarget.isDraft ? '删除草稿失败' : '移除方案失败', result.error.message);
        return;
      }
      setRuntimeSchemes((prev) => prev.filter((scheme) => scheme.id !== removeTarget.id));
      if (selectedSchemeId === removeTarget.id) setSelectedSchemeId(null);
      setRemoveTarget(null);
      toast.success(
        removeTarget.isDraft ? '草稿已删除' : '方案已移除',
        '已生成的图片仍保留在历史与图库中。',
      );
    } finally {
      setRemoveBusy(false);
    }
  };

  const runMarketSearch = async (term?: string) => {
    const keyword = (term ?? query).trim();
    if (!keyword) {
      toast.show({
        title: '输入想找的方向',
        description: '例如「插画 skill」「poster prompt」，再执行搜索。',
      });
      return;
    }
    if (term) setQuery(term);
    setMarketLoading(true);
    setMarketError(null);
    try {
      const result = await api.designScheme.marketSearch(keyword);
      if (result.ok) {
        setMarketResult(result.data);
      } else {
        setMarketResult(null);
        setMarketError(result.error.message);
      }
    } catch (error) {
      setMarketResult(null);
      setMarketError(error instanceof Error ? error.message : '搜索市场失败');
    } finally {
      setMarketLoading(false);
    }
  };

  /** 添加候选：进入真实创建管线（下载快照 → Agent 编译草稿），过程在 Composer 呈现。 */
  const addMarketCandidate = async (candidate: MarketCandidate) => {
    setInstallCandidate(null);
    setView('generate');
    const started = await useSchemeCreationStore.getState().start('', [candidate.repositoryUrl]);
    if (!started) {
      toast.show({
        title: '有创建任务正在进行',
        description: '等当前方案创建完成后再添加新的候选。',
      });
    }
  };

  const findInstalled = (candidate: MarketCandidate): DesignSchemeSummary | null =>
    runtimeSchemes.find((scheme) => scheme.sourceLabel === candidate.fullName) ?? null;

  useEffect(() => {
    void loadRuntimeSchemes();
    // Composer「查看详情 / 浏览全部 / 前往发现」等跨视图跳转在挂载时消费一次。
    const intent = useAppStore.getState().consumeSchemeCenterIntent();
    if (intent?.surface) setSurface(intent.surface);
    if (intent?.detailId) setRuntimeDetailId(intent.detailId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadRuntimeSchemes 是本组件内的稳定函数
  }, []);

  const chooseCreate = (kind: SchemeCreateKind) => {
    if (kind === 'github') {
      setView('generate');
      toast.show({
        title: '粘贴 GitHub Skill 地址',
        description: '在 Composer 中粘贴公开仓库、Skill 目录或 SKILL.md 地址。',
        variant: 'accent',
      });
      return;
    }
    if (kind === 'history') {
      setHistorySourceOpen(true);
      return;
    }
    if (kind === 'import') {
      void importSharePackage();
      return;
    }
    if (kind === 'idea') {
      // 想法创建走真实 Agent 管线：挂上指令芯片，回到 Composer 补想法后提交。
      useGenerationWorkbenchStore.getState().setDraftCommand('design-plan');
      setView('generate');
      toast.show({
        title: '描述你的方案想法',
        description: '输入想法后发送，Agent 会创建方案草稿；也可以附上 GitHub Skill 地址。',
        variant: 'accent',
      });
      return;
    }
    // 从提示词创建：同一条真实管线，预置整理提示词的说明，用户粘贴提示词后发送。
    const workbench = useGenerationWorkbenchStore.getState();
    workbench.setDraftCommand('design-plan');
    workbench.setDraftPrompt(
      '把下面这段提示词整理成一个可复用方案，区分固定规则、必需变量和可选补充：\n\n',
    );
    setView('generate');
    toast.show({
      title: '粘贴你的提示词',
      description: '在说明后粘贴提示词并发送，Agent 会整理成方案草稿。',
      variant: 'accent',
    });
  };

  const selectedScheme = selectedSchemeId
    ? (runtimeSchemes.find((scheme) => scheme.id === selectedSchemeId) ?? null)
    : null;
  const runtimeDetail = runtimeDetailId
    ? (runtimeSchemes.find((scheme) => scheme.id === runtimeDetailId) ?? null)
    : null;
  if (runtimeDetail) {
    return (
      <div className="h-full bg-elevated" data-testid="design-schemes-page">
        <SchemeRuntimeDetail
          scheme={runtimeDetail}
          onBack={() => setRuntimeDetailId(null)}
          onChanged={(updated) =>
            setRuntimeSchemes((prev) =>
              prev.map((scheme) => (scheme.id === updated.id ? updated : scheme)),
            )
          }
          onRemoved={() => {
            setRuntimeSchemes((prev) => prev.filter((scheme) => scheme.id !== runtimeDetail.id));
            setRuntimeDetailId(null);
          }}
        />
      </div>
    );
  }

  return (
    <div
      className="mf-scheme-workspace"
      data-inspector-open={selectedScheme ? 'true' : 'false'}
      data-testid="design-schemes-page"
    >
      <main className="mf-workspace-list-pane" data-testid="scheme-list-workspace">
        <div
          className={cn(
            'mf-workspace-list-content',
            selectedScheme && 'mf-workspace-list-content-wide',
          )}
        >
          <SchemeControlDeck
            surface={surface}
            runtimeCount={runtimeSchemes.length}
            marketCount={marketResult?.candidates.length}
            query={query}
            runtimeLoading={runtimeLoading}
            marketLoading={marketLoading}
            onSurfaceChange={(nextSurface) => {
              setSurface(nextSurface);
              setSelectedSchemeId(null);
            }}
            onQueryChange={setQuery}
            onRefresh={() => void loadRuntimeSchemes()}
            onMarketSearch={() => void runMarketSearch()}
            onCreate={chooseCreate}
          />
          {runtimeError && surface === 'mine' && (
            <div className="mt-4 rounded-md border border-danger/25 bg-danger/5 px-3 py-2 text-meta text-danger">
              {runtimeError}
            </div>
          )}
          {surface === 'mine' ? (
            <div className="mt-7">
              {runtimeLoading && mineEmpty ? (
                <div className="py-16 text-center text-[11px] text-tertiary">正在读取方案…</div>
              ) : mineEmpty ? (
                <div className="grid">
                  <EmptyList surface={surface} />
                </div>
              ) : (
                <>
                  <SchemeListSection
                    title="草稿"
                    count={runtimeDrafts.length}
                    showHeading={showRuntimeGroupHeadings}
                    singleColumn={Boolean(selectedScheme)}
                  >
                    {runtimeDrafts.map((scheme) => (
                      <RuntimeSchemeRow
                        key={scheme.id}
                        scheme={scheme}
                        selected={selectedSchemeId === scheme.id}
                        onOpen={() => setSelectedSchemeId(scheme.id)}
                        onRun={() => runRuntimeScheme(scheme)}
                        onRemove={() =>
                          setRemoveTarget({ id: scheme.id, name: scheme.name, isDraft: true })
                        }
                      />
                    ))}
                  </SchemeListSection>
                  <SchemeListSection
                    title="正式"
                    count={runtimeFormal.length}
                    showHeading={showRuntimeGroupHeadings}
                    singleColumn={Boolean(selectedScheme)}
                  >
                    {runtimeFormal.map((scheme) => (
                      <RuntimeSchemeRow
                        key={scheme.id}
                        scheme={scheme}
                        selected={selectedSchemeId === scheme.id}
                        onOpen={() => setSelectedSchemeId(scheme.id)}
                        onRun={() => runRuntimeScheme(scheme)}
                        onRemove={() =>
                          setRemoveTarget({ id: scheme.id, name: scheme.name, isDraft: false })
                        }
                      />
                    ))}
                  </SchemeListSection>
                </>
              )}
            </div>
          ) : (
            <div className="mt-7" data-testid="market-discover">
              {marketLoading ? (
                <div className="py-16 text-center text-[11px] text-tertiary">
                  正在搜索 GitHub 市场…
                </div>
              ) : marketError ? (
                <div className="mx-auto max-w-[420px] py-14 text-center">
                  <p className="text-[12px] font-medium text-primary">搜索市场失败</p>
                  <p className="mt-1.5 text-meta leading-5 text-tertiary">{marketError}</p>
                  <button
                    type="button"
                    onClick={() => {
                      void runMarketSearch();
                    }}
                    className="action-button mx-auto mt-4"
                  >
                    重试
                  </button>
                </div>
              ) : marketResult ? (
                <>
                  {marketResult.fromCache && (
                    <p
                      className="mb-3 rounded-md border border-border-subtle bg-inset/45 px-3 py-2 text-meta text-secondary"
                      data-testid="market-cache-notice"
                    >
                      网络暂不可用，以下是最近一次搜索的候选缓存。
                    </p>
                  )}
                  <SchemeListSection
                    title={`「${marketResult.query}」的候选`}
                    count={marketResult.candidates.length}
                  >
                    {marketResult.candidates.map((candidate) => {
                      const installed = findInstalled(candidate);
                      return (
                        <MarketCandidateRow
                          key={candidate.candidateId}
                          candidate={candidate}
                          installed={installed}
                          onAdd={() => setInstallCandidate(candidate)}
                          onOpenInstalled={() => installed && setSelectedSchemeId(installed.id)}
                        />
                      );
                    })}
                  </SchemeListSection>
                  {marketResult.candidates.length === 0 && (
                    <div className="grid">
                      <EmptyList surface={surface} />
                    </div>
                  )}
                </>
              ) : (
                <div className="mx-auto max-w-[460px] py-14 text-center">
                  <Search className="mx-auto h-5 w-5 text-quaternary" />
                  <p className="mt-3 text-[12px] font-medium text-primary">
                    从 GitHub 市场寻找设计方案
                  </p>
                  <p className="mt-1.5 text-meta leading-5 text-tertiary">
                    候选会显示许可证与风险提示，添加后需要本机试运行才能正式使用。
                  </p>
                  <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                    {['插画 skill', 'poster prompt', 'illustration style'].map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => {
                          void runMarketSearch(suggestion);
                        }}
                        className="rounded-md border border-border-subtle bg-elevated/45 px-2.5 py-1 text-meta text-secondary transition-colors hover:bg-hover hover:text-primary"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
      {selectedScheme && (
        <SchemeInspector
          scheme={selectedScheme}
          onClose={() => setSelectedSchemeId(null)}
          onOpenDetail={() => setRuntimeDetailId(selectedScheme.id)}
          onRun={() => runRuntimeScheme(selectedScheme)}
        />
      )}
      {installCandidate && (
        <MarketInstallDialog
          candidate={installCandidate}
          onCancel={() => setInstallCandidate(null)}
          onConfirm={() => {
            void addMarketCandidate(installCandidate);
          }}
        />
      )}
      {removeTarget && (
        <SchemeListRemoveDialog
          name={removeTarget.name}
          isDraft={removeTarget.isDraft}
          busy={removeBusy}
          onCancel={() => setRemoveTarget(null)}
          onConfirm={() => void confirmRemove()}
        />
      )}
      {historySourceOpen && (
        <HistorySourcePicker
          onCancel={() => setHistorySourceOpen(false)}
          onConfirm={({ items, note }) => {
            setHistorySourceOpen(false);
            // 真实创建路径：历史来源挂到 design-plan 指令上，提取说明进入 Composer 正文可继续编辑。
            const workbench = useGenerationWorkbenchStore.getState();
            workbench.setDraftCommand('design-plan');
            workbench.setDraftHistorySource({ items });
            workbench.setDraftPrompt(note);
            setView('generate');
            toast.show({
              title: '历史来源已就绪',
              description: '确认提取说明后发送，Agent 会生成方案草稿。',
              variant: 'accent',
            });
          }}
        />
      )}
    </div>
  );
}
