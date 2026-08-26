import { useState } from 'react';
import { ChevronDown, Plus, RefreshCw } from '../../components/ui/icons';
import { cn } from '../../lib/utils';
import { SchemeCreateMenu, type SchemeCreateKind } from './SchemeListActions';
import { SchemeSearchField } from './SchemeListPrimitives';
import { DropdownMenu, DropdownMenuTrigger } from '@musefold/ui';

export type SchemeSurface = 'mine' | 'discover';

interface SchemeControlDeckProps {
  surface: SchemeSurface;
  runtimeCount: number;
  marketCount?: number;
  query: string;
  runtimeLoading: boolean;
  marketLoading: boolean;
  onSurfaceChange: (surface: SchemeSurface) => void;
  onQueryChange: (query: string) => void;
  onRefresh: () => void;
  onMarketSearch: () => void;
  onCreate: (kind: SchemeCreateKind) => void;
}

export function SchemeControlDeck({
  surface,
  runtimeCount,
  marketCount,
  query,
  runtimeLoading,
  marketLoading,
  onSurfaceChange,
  onQueryChange,
  onRefresh,
  onMarketSearch,
  onCreate,
}: SchemeControlDeckProps) {
  const [createOpen, setCreateOpen] = useState(false);

  const chooseCreate = (kind: SchemeCreateKind) => {
    setCreateOpen(false);
    onCreate(kind);
  };

  return (
    <div className="mf-scheme-control-deck">
      <div className="mf-scheme-control-primary">
        <div className="mf-workspace-scope-tabs" role="tablist" aria-label="方案范围">
          <button
            type="button"
            role="tab"
            aria-selected={surface === 'mine'}
            onClick={() => onSurfaceChange('mine')}
            className="mf-workspace-scope-tab"
            data-testid="scheme-surface-mine"
          >
            <span>我的方案</span>
            <span className="mf-workspace-scope-count">{runtimeCount}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={surface === 'discover'}
            onClick={() => onSurfaceChange('discover')}
            className="mf-workspace-scope-tab"
            data-testid="scheme-surface-explore"
          >
            <span>发现</span>
            {marketCount !== undefined ? (
              <span className="mf-workspace-scope-count">{marketCount}</span>
            ) : null}
          </button>
        </div>
        <SchemeSearchField
          value={query}
          onChange={onQueryChange}
          placeholder={surface === 'discover' ? '搜索市场中的方案' : '搜索方案、来源或说明'}
          submitting={marketLoading}
          onSubmit={surface === 'discover' ? onMarketSearch : undefined}
        />
      </div>
      <div className="mf-scheme-control-secondary">
        <button
          type="button"
          onClick={onRefresh}
          disabled={runtimeLoading}
          className="mf-workspace-icon-action"
          aria-label="刷新方案"
          title="刷新方案"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', runtimeLoading && 'animate-spin')} />
        </button>
        <DropdownMenu open={createOpen} onOpenChange={setCreateOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="mf-workspace-create-action"
              data-testid="scheme-create"
            >
              <Plus className="h-3.5 w-3.5" />
              新建
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <SchemeCreateMenu onChoose={chooseCreate} />
        </DropdownMenu>
      </div>
    </div>
  );
}
