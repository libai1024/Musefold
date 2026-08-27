// 侧栏身份菜单的下拉内容(生图账号 / 生图中转站分组 + 管理入口)。
// 数据订阅与切换验证逻辑在 SidebarIdentityMenu;testid 契约见 model-hub-ui.test.ts 与 tests/e2e。
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@musefold/ui';
import { Check, ImageIcon, Loader2, Server, Sparkles, UserRound } from '../ui/icons';
import { ModelBrandIcon, matchModelBrand } from '../ui/brand-icons';
import { displayModelName } from '../../lib/model-catalog';

export interface IdentityAccountOption {
  source: 'official' | 'doubao';
  name: string;
  detail: string;
  active: boolean;
  avatarDataUrl: string | null;
  onChoose: () => void;
}

export interface IdentityRelayOption {
  id: string;
  name: string;
  model: string;
  active: boolean;
  pending: boolean;
}

interface IdentityMenuBodyProps {
  title: string;
  detail: string;
  accounts: IdentityAccountOption[];
  relayProviders: IdentityRelayOption[];
  pendingProviderId: string | null;
  chooseRelayProvider: (providerId: string) => Promise<void>;
  openSettingsAt: (section: 'account' | 'relay', relayTab?: 'providers' | 'ai') => void;
}

export function IdentityMenuBody({
  title,
  detail,
  accounts,
  relayProviders,
  pendingProviderId,
  chooseRelayProvider,
  openSettingsAt,
}: IdentityMenuBodyProps) {
  return (
    <>
      <div className="border-b border-border-subtle px-3 py-2.5">
        <p className="text-[11.5px] font-medium text-primary">{title}</p>
        <p className="mt-0.5 text-meta text-tertiary">{detail}</p>
      </div>
      <div className="max-h-[320px] overflow-y-auto p-1.5" aria-label="可用生图身份">
        <DropdownMenuLabel>生图账号</DropdownMenuLabel>
        <div role="group" aria-label="生图账号">
          {accounts.map((account) => (
            <DropdownMenuItem
              key={account.source}
              data-active={account.active || undefined}
              role="menuitemradio"
              aria-checked={account.active}
              onSelect={account.onChoose}
              className="mf-sidebar-access-item"
              data-testid={`account-source-option-${account.source}`}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border-subtle bg-inset text-[11px] font-semibold text-secondary">
                {account.avatarDataUrl ? (
                  <img src={account.avatarDataUrl} alt="" className="h-full w-full object-cover" />
                ) : account.source === 'official' ? (
                  <ModelBrandIcon model="musefold-agent" className="h-4 w-4" />
                ) : (
                  account.name.charAt(0) || <UserRound className="h-4 w-4" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11.5px] font-medium text-primary">
                  {account.name}
                </span>
                <span className="mt-0.5 block truncate text-meta text-tertiary">
                  {account.detail}
                </span>
              </span>
              {account.active && <Check className="h-3.5 w-3.5 shrink-0 text-accent" />}
            </DropdownMenuItem>
          ))}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>生图中转站</DropdownMenuLabel>
        {relayProviders.length > 0 && (
          <div role="group" aria-label="生图中转站">
            {relayProviders.map((provider) => {
              const active = provider.active;
              return (
                <DropdownMenuItem
                  key={provider.id}
                  data-active={active || undefined}
                  role="menuitemradio"
                  aria-checked={active}
                  disabled={Boolean(pendingProviderId)}
                  onSelect={(event) => {
                    event.preventDefault();
                    void chooseRelayProvider(provider.id);
                  }}
                  className="mf-sidebar-access-item"
                  data-testid={`relay-model-option-${provider.id}`}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-inset text-secondary">
                    {matchModelBrand(provider.model) !== 'generic' ? (
                      <ModelBrandIcon model={provider.model} className="h-4 w-4" />
                    ) : (
                      <Server className="h-4 w-4" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11.5px] font-medium text-primary">
                      {provider.name}
                    </span>
                    <span className="mt-0.5 block truncate text-meta text-tertiary">
                      {displayModelName(provider.model)}
                    </span>
                  </span>
                  {provider.pending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-tertiary" />
                  ) : (
                    active && <Check className="h-3.5 w-3.5 text-accent" />
                  )}
                </DropdownMenuItem>
              );
            })}
          </div>
        )}
        {relayProviders.length === 0 && (
          <DropdownMenuItem
            onSelect={() => openSettingsAt('relay')}
            className="mf-sidebar-access-item"
            data-testid="relay-model-configure"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-inset text-secondary">
              <Server className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11.5px] font-medium text-primary">
                配置中转站
              </span>
              <span className="mt-0.5 block truncate text-meta text-tertiary">
                自备生图与 Agent 模型网关
              </span>
            </span>
          </DropdownMenuItem>
        )}
      </div>
      <DropdownMenuSeparator />
      <div className="p-1.5">
        <DropdownMenuItem
          onSelect={() => openSettingsAt('relay', 'providers')}
          className="mf-sidebar-access-item px-2 py-2"
          data-testid="relay-model-manage"
        >
          <ImageIcon className="h-3.5 w-3.5 shrink-0" /> 管理生图中转站
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => openSettingsAt('relay', 'ai')}
          className="mf-sidebar-access-item px-2 py-2"
          data-testid="relay-model-manage-ai"
        >
          <Sparkles className="h-3.5 w-3.5 shrink-0" /> 管理 Agent 中转站
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => openSettingsAt('account')}
          className="mf-sidebar-access-item px-2 py-2"
          data-testid="identity-account-settings"
        >
          <UserRound className="h-3.5 w-3.5 shrink-0" /> 账号设置
        </DropdownMenuItem>
      </div>
    </>
  );
}
