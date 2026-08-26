import { useMemo, useState, type ReactNode } from 'react';
import type { PromptListItemViewModel } from '../models';
import { PromptListRow } from './PromptListRow';
import { PromptSearchField } from './PromptSearchField';
import { PromptSectionHeading } from './PromptSectionHeading';
import { ProductPageHeader } from '../navigation/ProductPageHeader';

export interface PromptLibraryScreenProps {
  prompts: PromptListItemViewModel[];
  className?: string;
  showPageHeader?: boolean;
  headerAction?: ReactNode;
  toolbarExtra?: ReactNode;
  scopeNavigation?: ReactNode;
  sectionSummary?: ReactNode;
  createPanel?: ReactNode;
  body?: ReactNode;
  query?: string;
  onQueryChange?: (value: string) => void;
  copiedId?: string | null;
  selectedId?: string | null;
  onOpen?: (prompt: PromptListItemViewModel) => void;
  onCopy?: (prompt: PromptListItemViewModel) => void;
  onUse?: (prompt: PromptListItemViewModel) => void;
}

export function PromptLibraryScreen({
  prompts,
  className,
  showPageHeader = true,
  headerAction,
  toolbarExtra,
  scopeNavigation,
  sectionSummary,
  createPanel,
  body,
  query,
  onQueryChange,
  copiedId,
  selectedId,
  onOpen,
  onCopy,
  onUse,
}: PromptLibraryScreenProps) {
  const [internalQuery, setInternalQuery] = useState('');
  const currentQuery = query ?? internalQuery;
  const setQuery = onQueryChange ?? setInternalQuery;
  const filtered = useMemo(() => {
    const needle = currentQuery.trim().toLocaleLowerCase();
    if (!needle) return prompts;
    return prompts.filter((prompt) =>
      [prompt.title, prompt.content, ...(prompt.tags ?? [])].some((value) =>
        value.toLocaleLowerCase().includes(needle),
      ),
    );
  }, [currentQuery, prompts]);
  const sections = [
    {
      key: 'pinned',
      title: '置顶',
      items: filtered.filter((item) => item.isPinned),
    },
    {
      key: 'all',
      title: '全部',
      items: filtered.filter((item) => !item.isPinned),
    },
  ];
  const useControlDeck = Boolean(scopeNavigation || sectionSummary);

  return (
    <section
      className={['mf-product-page mf-library-screen', className].filter(Boolean).join(' ')}
      data-testid="library-page"
    >
      {showPageHeader ? (
        <ProductPageHeader title="提示词库" count={filtered.length} actions={headerAction} />
      ) : null}
      {useControlDeck ? (
        <div className="mf-library-control-deck">
          <div className="mf-library-control-primary">
            <div className="mf-library-scope-slot">{scopeNavigation}</div>
            <PromptSearchField
              value={currentQuery}
              onChange={setQuery}
              placeholder="搜索标题、正文或标签"
            />
          </div>
          <div className="mf-library-control-secondary">
            {sectionSummary ? (
              <div className="mf-library-section-summary">{sectionSummary}</div>
            ) : null}
            {!showPageHeader ? headerAction : null}
          </div>
        </div>
      ) : (
        <div className="mf-library-toolbar">
          <PromptSearchField
            value={currentQuery}
            onChange={setQuery}
            placeholder="搜索标题、正文或标签"
          />
          {toolbarExtra}
          {!showPageHeader ? headerAction : null}
        </div>
      )}
      {createPanel}
      {body ?? (
        <div role="list">
          {sections.map((section) =>
            section.items.length > 0 ? (
              <section className="mf-prompt-section" key={section.key}>
                <PromptSectionHeading title={section.title} count={section.items.length} />
                <div className="mf-prompt-grid">
                  {section.items.map((prompt) => (
                    <PromptListRow
                      key={prompt.id}
                      prompt={prompt}
                      highlighted={selectedId === prompt.id}
                      copied={copiedId === prompt.id}
                      onOpen={onOpen ? () => onOpen(prompt) : undefined}
                      onCopy={onCopy ? () => onCopy(prompt) : undefined}
                      onUse={() => onUse?.(prompt)}
                    />
                  ))}
                </div>
              </section>
            ) : null,
          )}
          {filtered.length === 0 && <div className="mf-empty-row">没有匹配的提示词</div>}
        </div>
      )}
    </section>
  );
}
