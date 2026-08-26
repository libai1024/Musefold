import { useMemo, type ReactNode } from 'react';
import { Search, X } from '@musefold/ui/icons';
import { Input } from '@musefold/ui';

export interface SettingsNavigationItem {
  id: string;
  label: string;
  icon: ReactNode;
  keywords?: readonly string[];
}

export interface SettingsNavigationGroup {
  id: string;
  label: string;
  icon: ReactNode;
  items: readonly SettingsNavigationItem[];
}

export interface SettingsWorkspaceProps {
  groups: readonly SettingsNavigationGroup[];
  activeSection: string;
  onSectionChange: (sectionId: string) => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  headerAction?: ReactNode;
  navFooter?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}

function normalized(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase();
}

export function filterSettingsNavigationGroups(
  groups: readonly SettingsNavigationGroup[],
  query: string,
): SettingsNavigationGroup[] {
  const needle = normalized(query);
  if (!needle) return groups.map((group) => ({ ...group, items: [...group.items] }));

  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        normalized([group.label, item.label, ...(item.keywords ?? [])].join(' ')).includes(needle),
      ),
    }))
    .filter((group) => group.items.length > 0);
}

function SearchField({
  value,
  onChange,
  placeholder,
  testId,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  testId?: string;
}) {
  return (
    <div className="mf-settings-search" data-testid={testId}>
      <Search aria-hidden="true" />
      <span className="mf-sr-only">搜索设置</span>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="搜索设置"
        placeholder={placeholder}
      />
      {value ? (
        <button
          type="button"
          className="mf-settings-search-clear"
          aria-label="清空设置搜索"
          title="清空设置搜索"
          onClick={() => onChange('')}
        >
          <X aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

function NavigationGroups({
  groups,
  activeSection,
  onSectionChange,
}: {
  groups: readonly SettingsNavigationGroup[];
  activeSection: string;
  onSectionChange: (sectionId: string) => void;
}) {
  if (groups.length === 0) {
    return <p className="mf-settings-nav-empty">没有匹配的设置</p>;
  }

  return groups.map((group) => (
    <section
      className="mf-settings-nav-group"
      key={group.id}
      aria-labelledby={`settings-nav-${group.id}`}
    >
      <h2 id={`settings-nav-${group.id}`}>{group.label}</h2>
      <div>
        {group.items.map((item) => {
          const active = item.id === activeSection;
          return (
            <button
              type="button"
              className="mf-settings-nav-item"
              data-active={active || undefined}
              aria-current={active ? 'page' : undefined}
              data-testid={`settings-section-${item.id}`}
              key={item.id}
              onClick={() => onSectionChange(item.id)}
            >
              <span className="mf-settings-nav-item-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  ));
}

export function SettingsWorkspace({
  groups,
  activeSection,
  onSectionChange,
  searchValue,
  onSearchChange,
  searchPlaceholder = '搜索设置...',
  headerAction,
  navFooter,
  children,
  className,
  testId,
}: SettingsWorkspaceProps) {
  const filteredGroups = useMemo(
    () => filterSettingsNavigationGroups(groups, searchValue),
    [groups, searchValue],
  );

  return (
    <div
      className={`mf-settings-workspace${className ? ` ${className}` : ''}`}
      data-testid={testId}
      data-ui-register="operate"
    >
      <aside className="mf-settings-sidebar" aria-label="设置导航">
        <header className="mf-settings-sidebar-header">
          {headerAction}
          <SearchField
            value={searchValue}
            onChange={onSearchChange}
            placeholder={searchPlaceholder}
            testId="settings-sidebar-search"
          />
        </header>
        <nav className="mf-settings-nav" aria-label="设置分区">
          <NavigationGroups
            groups={filteredGroups}
            activeSection={activeSection}
            onSectionChange={onSectionChange}
          />
        </nav>
        {navFooter ? <footer className="mf-settings-sidebar-footer">{navFooter}</footer> : null}
      </aside>

      <header
        className="mf-settings-compact-header"
        data-testid="settings-compact-header"
        aria-label="设置工具栏"
      >
        {headerAction ? (
          <div className="mf-settings-compact-header-action">{headerAction}</div>
        ) : null}
        <SearchField
          value={searchValue}
          onChange={onSearchChange}
          placeholder={searchPlaceholder}
          testId="settings-compact-search"
        />
      </header>

      <nav className="mf-settings-tabs" aria-label="设置分区">
        <div className="mf-settings-tabs-list">
          {filteredGroups
            .flatMap((group) => group.items)
            .map((item) => (
              <button
                type="button"
                className="mf-settings-tab-item"
                data-active={item.id === activeSection || undefined}
                aria-current={item.id === activeSection ? 'page' : undefined}
                data-testid={`settings-mobile-section-${item.id}`}
                key={item.id}
                onClick={() => onSectionChange(item.id)}
              >
                {item.label}
              </button>
            ))}
        </div>
      </nav>

      <div className="mf-settings-pane">{children}</div>
    </div>
  );
}
