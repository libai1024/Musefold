import { Loader2Icon } from 'lucide-react';

import { cn } from '@musefold/ui/lib/utils';

function Spinner({ className, ...props }: React.ComponentProps<'svg'>) {
  return (
    <Loader2Icon
      role="status"
      aria-label="Loading"
      // 信息性动画:减少动效分级下豁免压制(冻结的加载圈会被误读为卡死)。
      data-motion-exempt=""
      className={cn('size-4 animate-spin', className)}
      {...props}
    />
  );
}

export { Spinner };
