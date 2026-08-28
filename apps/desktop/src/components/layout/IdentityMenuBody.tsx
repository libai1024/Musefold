// 侧栏身份菜单的下拉内容(生图账号 / 生图中转站分组 + 管理入口)。
// 数据订阅与切换验证逻辑在 SidebarIdentityMenu;testid 契约见 model-hub-ui.test.ts 与 tests/e2e。
import { ProductSidebarIdentityMenuContent } from '@musefold/product-ui';
import { ImageIcon, Server, Sparkles, UserRound } from '../ui/icons';
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
    <ProductSidebarIdentityMenuContent
      title={title}
      detail={detail}
      accounts={accounts.map((account) => ({
        id: account.source,
        name: account.name,
        detail: account.detail,
        active: account.active,
        avatar: account.avatarDataUrl ? (
          <img src={account.avatarDataUrl} alt="" className="h-full w-full object-cover" />
        ) : account.source === 'official' ? (
          <ModelBrandIcon model="musefold-agent" className="h-4 w-4" />
        ) : (
          account.name.charAt(0) || <UserRound className="h-4 w-4" />
        ),
        onSelect: account.onChoose,
        testId: `account-source-option-${account.source}`,
      }))}
      relayProviders={relayProviders.map((provider) => ({
        id: provider.id,
        name: provider.name,
        modelLabel: displayModelName(provider.model),
        icon:
          matchModelBrand(provider.model) !== 'generic' ? (
            <ModelBrandIcon model={provider.model} className="h-4 w-4" />
          ) : (
            <Server className="h-4 w-4" />
          ),
        active: provider.active,
        pending: provider.pending,
        disabled: Boolean(pendingProviderId),
        preventClose: true,
        onSelect: () => void chooseRelayProvider(provider.id),
        testId: `relay-model-option-${provider.id}`,
      }))}
      relayEmptyAction={
        relayProviders.length === 0
          ? {
              label: '配置中转站',
              detail: '自备生图与 Agent 模型网关',
              icon: <Server className="h-4 w-4" />,
              onSelect: () => openSettingsAt('relay'),
              testId: 'relay-model-configure',
            }
          : undefined
      }
      actions={[
        {
          label: '管理生图中转站',
          icon: <ImageIcon className="h-3.5 w-3.5 shrink-0" />,
          onSelect: () => openSettingsAt('relay', 'providers'),
          testId: 'relay-model-manage',
        },
        {
          label: '管理 Agent 中转站',
          icon: <Sparkles className="h-3.5 w-3.5 shrink-0" />,
          onSelect: () => openSettingsAt('relay', 'ai'),
          testId: 'relay-model-manage-ai',
        },
        {
          label: '账号设置',
          icon: <UserRound className="h-3.5 w-3.5 shrink-0" />,
          onSelect: () => openSettingsAt('account'),
          testId: 'identity-account-settings',
        },
      ]}
    />
  );
}
