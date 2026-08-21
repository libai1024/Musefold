import { useQuery } from '@tanstack/react-query';
import { musefoldQueryKeys } from '@musefold/product-ui';
import { getAccountDesktopExtras } from './store';

export function useAccountStatusQuery() {
  return useQuery({
    queryKey: musefoldQueryKeys.account.status,
    queryFn: () => getAccountDesktopExtras().accountStatus(),
  });
}
