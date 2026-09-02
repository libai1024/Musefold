'use client';

import type { DesignSchemeSummary, MarketCandidate } from '@musefold/contracts';
import { useCapabilities } from '@musefold/platform';
import { Button } from '@musefold/ui/components/button';
import { Sheet, SheetContent, SheetTitle } from '@musefold/ui/components/sheet';
import { toast } from '@musefold/ui/components/sonner';
import { Blocks, Search } from '@musefold/ui/icons';
import { useMemo, useState } from 'react';
import { useMediaQuery } from '../history/hooks';
import { HistorySourcePicker } from './HistorySourcePicker';
import { useMarketSearch, useRemoveScheme, useSchemeList } from './hooks';
import { SchemeControlDeck } from './SchemeControlDeck';
import { SchemeDetailView } from './SchemeDetailView';
import { MarketInstallDialog, SchemeRemoveDialog } from './SchemeDialogs';
import { SchemeInspector } from './SchemeInspector';
import {
  SchemeEmptyState,
  SchemeInlineError,
  SchemeListSection,
  SchemeListSkeleton,
} from './SchemeListPrimitives';
import { MarketCandidateRow, SchemeRow } from './SchemeRows';
import {
  createKindDisabledReason,
  type DesignSchemesActions,
  type ResolveSchemeAssetUrl,
  type SchemeCreateKind,
  type SchemeSurface,
} from './types';

const MARKET_SUGGESTIONS = ['插画 skill', 'poster prompt', 'illustration style'];

export interface SchemesScreenProps {
  /** 宿主/集成层动作接缝(工作台运行/修改/创建管线/导入对话框/市场安装)。 */
  actions?: DesignSchemesActions;
  /** 方案资产(cover/相册)展示地址解析器:桌面 media:// / 云端重定向。 */
  resolveAssetUrl?: ResolveSchemeAssetUrl;
  /** 深链初始态(承旧 consumeSchemeCenterIntent):由集成层从 screen-intent 翻译传入。 */
  initialSurface?: SchemeSurface;
  initialDetailId?: string;
}

/**
 * 设计方案屏(v2.5 迁入,ui-parity 06 §2 蓝图):
 * SchemeControlDeck(范围 tabs + 搜索 + 刷新 + 新建)+ 我的方案(草稿/正式分节行式列表)
 * + 发现(显式市场搜索)+ SchemeInspector(lg+ 内嵌右栏 / 窄屏 Sheet)+ 整屏详情。
 * 能力关闭(hasDesignSchemes=false)时整体不渲染,导航层负责不出现入口(D2)。
 */
export function SchemesScreen({
  actions = {},
  resolveAssetUrl,
  initialSurface = 'mine',
  initialDetailId,
}: SchemesScreenProps) {
  const capabilities = useCapabilities();
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  const [surface, setSurface] = useState<SchemeSurface>(initialSurface);
  const [query, setQuery] = useState('');
  const [selectedSchemeId, setSelectedSchemeId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(initialDetailId ?? null);
  const [createOpen, setCreateOpen] = useState(false);
  const [historySourceOpen, setHistorySourceOpen] = useState(false);
  const [installCandidate, setInstallCandidate] = useState<MarketCandidate | null>(null);
  const [removeTarget, setRemoveTarget] = useState<DesignSchemeSummary | null>(null);

  const list = useSchemeList();
  const marketSearch = useMarketSearch();
  const removeScheme = useRemoveScheme();

  const schemes = useMemo(() => list.data?.items ?? [], [list.data]);
  const normalized = query.trim().toLowerCase();
  // 客户端过滤(承旧):名称/摘要/来源联排匹配。
  const filtered = useMemo(
    () =>
      schemes.filter(
        (scheme) =>
          !normalized ||
          [scheme.name, scheme.summary, scheme.sourceLabel]
            .join(' ')
            .toLowerCase()
            .includes(normalized),
      ),
    [schemes, normalized],
  );
  const drafts = filtered.filter((scheme) => scheme.status === 'draft');
  const formal = filtered.filter((scheme) => scheme.status === 'formal');
  const showGroupHeadings = drafts.length > 0 && formal.length > 0;

  const selectedScheme = selectedSchemeId
    ? (schemes.find((scheme) => scheme.id === selectedSchemeId) ?? null)
    : null;
  const marketResult = marketSearch.data ?? null;

  if (!capabilities.hasDesignSchemes) return null;

  const runDisabledReason = actions.onRunScheme ? null : '当前环境暂未接入方案运行';

  function runScheme(scheme: DesignSchemeSummary) {
    actions.onRunScheme?.(scheme, scheme.status === 'formal' ? 'formal' : 'trial');
  }

  function chooseCreate(kind: SchemeCreateKind) {
    if (kind === 'history') {
      setHistorySourceOpen(true);
      return;
    }
    if (kind === 'import') {
      actions.onImportScheme?.();
      return;
    }
    actions.onCreateScheme?.(kind);
  }

  async function runMarketSearch(term?: string) {
    const keyword = (term ?? query).trim();
    if (!keyword) {
      toast('输入想找的方向', {
        description: '例如「插画 skill」「poster prompt」，再执行搜索。',
      });
      return;
    }
    if (term) setQuery(term);
    try {
      await marketSearch.mutateAsync({ query: keyword });
    } catch {
      // 错误态由 marketSearch.isError 就地呈现(I4),不再弹 toast。
    }
  }

  function confirmRemove() {
    if (!removeTarget || removeScheme.isPending) return;
    const isDraft = removeTarget.status === 'draft';
    removeScheme.mutate(
      { schemeId: removeTarget.id, expectedVersion: removeTarget.version },
      {
        onSuccess: () => {
          if (selectedSchemeId === removeTarget.id) setSelectedSchemeId(null);
          setRemoveTarget(null);
          toast.success(isDraft ? '草稿已删除' : '方案已移除', {
            description: '已生成的图片仍保留在历史与图库中。',
          });
        },
        onError: (error) => {
          toast.error(isDraft ? '删除草稿失败' : '移除方案失败', {
            description: error instanceof Error ? error.message : '操作失败',
          });
        },
      },
    );
  }

  function findInstalled(candidate: MarketCandidate): DesignSchemeSummary | null {
    return schemes.find((scheme) => scheme.sourceLabel === candidate.fullName) ?? null;
  }

  // 整屏详情(承旧:点行 → SchemeRuntimeDetail 全屏详情,返回回列表)。
  if (detailId) {
    return (
      <div className="h-full min-h-0 bg-background" data-testid="design-schemes-page">
        <SchemeDetailView
          schemeId={detailId}
          resolveAssetUrl={resolveAssetUrl}
          actions={actions}
          onBack={() => setDetailId(null)}
          onRemoved={() => setDetailId(null)}
        />
      </div>
    );
  }

  const inspector = selectedScheme ? (
    <SchemeInspector
      scheme={selectedScheme}
      resolveAssetUrl={resolveAssetUrl}
      runDisabledReason={runDisabledReason}
      onClose={() => setSelectedSchemeId(null)}
      onOpenDetail={() => setDetailId(selectedScheme.id)}
      onRun={() => runScheme(selectedScheme)}
    />
  ) : null;

  return (
    <div
      className="flex h-full min-h-0"
      data-inspector-open={selectedScheme ? 'true' : 'false'}
      data-testid="design-schemes-page"
    >
      <main className="min-w-0 flex-1 overflow-y-auto" data-testid="scheme-list-workspace">
        <div className="mx-auto w-full max-w-5xl px-4 py-4">
          <SchemeControlDeck
            surface={surface}
            mineCount={schemes.length}
            marketCount={marketResult?.candidates.length}
            query={query}
            listLoading={list.isPending || list.isRefetching}
            marketLoading={marketSearch.isPending}
            createOpen={createOpen}
            onCreateOpenChange={setCreateOpen}
            createDisabledReason={(kind) => createKindDisabledReason(kind, actions)}
            onSurfaceChange={(next) => {
              setSurface(next);
              setSelectedSchemeId(null);
            }}
            onQueryChange={setQuery}
            onRefresh={() => void list.refetch()}
            onMarketSearch={() => void runMarketSearch()}
            onCreate={chooseCreate}
          />

          {surface === 'mine' ? (
            <div className="mt-7">
              {list.isPending ? (
                <SchemeListSkeleton />
              ) : list.isError ? (
                <SchemeInlineError
                  title="读取设计方案失败"
                  message={list.error instanceof Error ? list.error.message : null}
                  onRetry={() => void list.refetch()}
                  testId="scheme-list-error"
                />
              ) : filtered.length === 0 ? (
                normalized ? (
                  <SchemeEmptyState
                    icon={<Search className="size-5" aria-hidden />}
                    title="没有找到匹配的方案"
                    hint="换一个名称、作者或仓库地址试试"
                    testId="scheme-list-empty-search"
                  />
                ) : (
                  <SchemeEmptyState
                    icon={<Blocks className="size-6" aria-hidden />}
                    title="还没有设计方案"
                    hint="从 GitHub 仓库、历史内容或分享包创建你的第一个可复用方案。"
                    cta={
                      <Button
                        size="sm"
                        onClick={() => setCreateOpen(true)}
                        data-testid="scheme-empty-create"
                      >
                        新建方案
                      </Button>
                    }
                    testId="scheme-list-empty"
                  />
                )
              ) : (
                <>
                  <SchemeListSection
                    title="草稿"
                    count={drafts.length}
                    showHeading={showGroupHeadings}
                    singleColumn={Boolean(selectedScheme)}
                  >
                    {drafts.map((scheme) => (
                      <SchemeRow
                        key={scheme.id}
                        scheme={scheme}
                        selected={selectedSchemeId === scheme.id}
                        resolveAssetUrl={resolveAssetUrl}
                        runDisabledReason={runDisabledReason}
                        onOpen={() => setSelectedSchemeId(scheme.id)}
                        onRun={() => runScheme(scheme)}
                        onRemove={() => setRemoveTarget(scheme)}
                      />
                    ))}
                  </SchemeListSection>
                  <SchemeListSection
                    title="正式"
                    count={formal.length}
                    showHeading={showGroupHeadings}
                    singleColumn={Boolean(selectedScheme)}
                  >
                    {formal.map((scheme) => (
                      <SchemeRow
                        key={scheme.id}
                        scheme={scheme}
                        selected={selectedSchemeId === scheme.id}
                        resolveAssetUrl={resolveAssetUrl}
                        runDisabledReason={runDisabledReason}
                        onOpen={() => setSelectedSchemeId(scheme.id)}
                        onRun={() => runScheme(scheme)}
                        onRemove={() => setRemoveTarget(scheme)}
                      />
                    ))}
                  </SchemeListSection>
                </>
              )}
            </div>
          ) : (
            <div className="mt-7" data-testid="market-discover">
              {marketSearch.isPending ? (
                <div className="py-16 text-center text-[11px] text-muted-foreground">
                  正在搜索 GitHub 市场…
                </div>
              ) : marketSearch.isError ? (
                <SchemeInlineError
                  title="搜索市场失败"
                  message={marketSearch.error instanceof Error ? marketSearch.error.message : null}
                  onRetry={() => void runMarketSearch()}
                  testId="market-error"
                />
              ) : marketResult ? (
                <>
                  {marketResult.fromCache ? (
                    <p
                      className="mb-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground"
                      data-testid="market-cache-notice"
                    >
                      网络暂不可用，以下是最近一次搜索的候选缓存。
                    </p>
                  ) : null}
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
                          addDisabledReason={
                            actions.onInstallMarketCandidate ? null : '当前环境暂未接入市场安装'
                          }
                          onAdd={() => setInstallCandidate(candidate)}
                          onOpenInstalled={() => installed && setSelectedSchemeId(installed.id)}
                        />
                      );
                    })}
                  </SchemeListSection>
                  {marketResult.candidates.length === 0 ? (
                    <SchemeEmptyState
                      icon={<Search className="size-5" aria-hidden />}
                      title="没有找到匹配的结果"
                      hint="换一个名称、作者或仓库地址试试"
                      testId="market-empty"
                    />
                  ) : null}
                </>
              ) : (
                <div className="mx-auto max-w-[460px] py-14 text-center" data-testid="market-idle">
                  <Search className="mx-auto size-5 text-muted-foreground/60" aria-hidden />
                  <p className="mt-3 font-medium text-foreground text-xs">
                    从 GitHub 市场寻找设计方案
                  </p>
                  <p className="mt-1.5 text-[11px] text-muted-foreground leading-5">
                    候选会显示许可证与风险提示，添加后需要本机试运行才能正式使用。
                  </p>
                  <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                    {MARKET_SUGGESTIONS.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => void runMarketSearch(suggestion)}
                        className="rounded-md border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        data-testid={`market-suggestion-${suggestion}`}
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

      {isDesktop ? (
        selectedScheme ? (
          <aside
            className="hidden w-96 shrink-0 border-border border-l lg:block"
            data-testid="scheme-inspector-shell"
          >
            {inspector}
          </aside>
        ) : null
      ) : (
        <Sheet
          open={selectedScheme != null}
          onOpenChange={(open) => !open && setSelectedSchemeId(null)}
        >
          <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-96 [&>button]:hidden">
            <SheetTitle className="sr-only">方案详情</SheetTitle>
            <div data-testid="scheme-inspector-shell" className="h-full">
              {inspector}
            </div>
          </SheetContent>
        </Sheet>
      )}

      <MarketInstallDialog
        candidate={installCandidate}
        onCancel={() => setInstallCandidate(null)}
        onConfirm={() => {
          const candidate = installCandidate;
          setInstallCandidate(null);
          if (candidate) actions.onInstallMarketCandidate?.(candidate);
        }}
      />
      <SchemeRemoveDialog
        scheme={removeTarget}
        busy={removeScheme.isPending}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={confirmRemove}
      />
      <HistorySourcePicker
        open={historySourceOpen}
        onCancel={() => setHistorySourceOpen(false)}
        onConfirm={(selection) => {
          setHistorySourceOpen(false);
          actions.onCreateFromHistory?.(selection);
        }}
      />
    </div>
  );
}
