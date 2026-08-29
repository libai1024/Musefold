import { cn } from '@musefold/ui/lib/utils';

/**
 * Kbd 原语(00-codex-craft §5.4,C-2):菜单右列 / tooltip 内联 / 设置快捷键表三处共用。
 * 形态:11px mono、1px `--border`、底 `--muted`(暗色 `--secondary`)、`--radius-sm`、内距 1px 6px。
 * 只用于展示真实接线的快捷键(00 法则 6:kbd 提示与实际未绑定即撒谎)。
 */
function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'inline-flex items-center rounded-sm border border-border bg-muted px-1.5 py-px font-mono font-normal text-[11px] text-muted-foreground leading-4 dark:bg-secondary',
        className,
      )}
      {...props}
    />
  );
}

export { Kbd };
