'use client';

import { Button } from '@musefold/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@musefold/ui/components/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from '@musefold/ui/components/tabs';
import {
  ChevronDown,
  FileUp,
  GitBranch,
  History,
  Plus,
  RefreshCw,
  Sparkles,
  Wand2,
} from '@musefold/ui/icons';
import { cn } from '@musefold/ui/lib/utils';
import { SchemeSearchField } from './SchemeListPrimitives';
import type { SchemeCreateKind, SchemeSurface } from './types';

const CREATE_ITEMS: Array<{
  id: SchemeCreateKind;
  label: string;
  hint: string;
  icon: typeof Sparkles;
}> = [
  { id: 'idea', label: '从一个想法开始', hint: '描述可重复使用的创作方式', icon: Sparkles },
  { id: 'github', label: '从 GitHub 添加', hint: '识别 Skill 或提示词仓库', icon: GitBranch },
  { id: 'history', label: '从历史内容创建', hint: '选择图片、消息与提示词', icon: History },
  { id: 'prompt', label: '从提示词创建', hint: '整理固定规则和变量', icon: Wand2 },
  { id: 'import', label: '导入分享包', hint: '.musefold.design 文件', icon: FileUp },
];

/**
 * 顶部控制台(承旧 SchemeControlDeck):
 * scope tabs(我的方案 | 发现,带计数)+ 搜索框 + 刷新 + 新建菜单。
 */
export function SchemeControlDeck({
  surface,
  mineCount,
  marketCount,
  query,
  listLoading,
  marketLoading,
  createOpen,
  onCreateOpenChange,
  createDisabledReason,
  onSurfaceChange,
  onQueryChange,
  onRefresh,
  onMarketSearch,
  onCreate,
}: {
  surface: SchemeSurface;
  mineCount: number;
  /** 未搜索过 = undefined(发现 tab 不显示计数)。 */
  marketCount?: number;
  query: string;
  listLoading: boolean;
  marketLoading: boolean;
  createOpen: boolean;
  onCreateOpenChange(open: boolean): void;
  /** 入口禁用理由(宿主未接入对应接缝);null = 可用。 */
  createDisabledReason(kind: SchemeCreateKind): string | null;
  onSurfaceChange(surface: SchemeSurface): void;
  onQueryChange(query: string): void;
  onRefresh(): void;
  onMarketSearch(): void;
  onCreate(kind: SchemeCreateKind): void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tabs value={surface} onValueChange={(next) => onSurfaceChange(next as SchemeSurface)}>
        <TabsList className="h-8" role="tablist" aria-label="方案范围">
          <TabsTrigger value="mine" className="gap-1.5 text-xs" data-testid="scheme-surface-mine">
            我的方案
            <span className="text-[11px] text-muted-foreground tabular-nums">{mineCount}</span>
          </TabsTrigger>
          <TabsTrigger
            value="discover"
            className="gap-1.5 text-xs"
            data-testid="scheme-surface-explore"
          >
            发现
            {marketCount !== undefined ? (
              <span className="text-[11px] text-muted-foreground tabular-nums">{marketCount}</span>
            ) : null}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="min-w-56 flex-1">
        <SchemeSearchField
          value={query}
          onChange={onQueryChange}
          placeholder={surface === 'discover' ? '搜索市场中的方案' : '搜索方案、来源或说明'}
          submitting={marketLoading}
          onSubmit={surface === 'discover' ? onMarketSearch : undefined}
        />
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground"
          onClick={onRefresh}
          disabled={listLoading}
          aria-label="刷新方案"
          title="刷新方案"
          data-testid="scheme-refresh"
        >
          <RefreshCw className={cn('size-3.5', listLoading && 'animate-spin')} aria-hidden />
        </Button>
        <DropdownMenu open={createOpen} onOpenChange={onCreateOpenChange}>
          <DropdownMenuTrigger asChild>
            <Button variant="default" size="sm" className="gap-1" data-testid="scheme-create">
              <Plus className="size-3.5" aria-hidden />
              新建
              <ChevronDown className="size-3.5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={8}
            className="w-64"
            aria-label="新建方案"
            data-testid="scheme-create-menu"
          >
            {CREATE_ITEMS.map((item) => {
              const reason = createDisabledReason(item.id);
              const Icon = item.icon;
              return (
                <DropdownMenuItem
                  key={item.id}
                  disabled={reason != null}
                  title={reason ?? undefined}
                  onSelect={() => {
                    onCreateOpenChange(false);
                    onCreate(item.id);
                  }}
                  className="flex items-start gap-2.5 py-2"
                  data-testid={`scheme-create-option-${item.id}`}
                >
                  <span
                    className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
                    aria-hidden
                  >
                    <Icon className="size-3.5" />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-foreground text-xs">{item.label}</span>
                    <span className="text-[11px] text-muted-foreground">{item.hint}</span>
                  </span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
