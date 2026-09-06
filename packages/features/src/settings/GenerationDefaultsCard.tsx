import type { GenerationQuality } from '@musefold/contracts';
import { Button } from '@musefold/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@musefold/ui/components/card';
import { Label } from '@musefold/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@musefold/ui/components/select';
import { Separator } from '@musefold/ui/components/separator';
import { Skeleton } from '@musefold/ui/components/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@musefold/ui/components/toggle-group';
import { QUALITY_OPTIONS, RATIO_CATALOG } from '../workbench/Composer';
import { usePreferences, useUpdatePreferences } from './hooks';
import { SEGMENT_GROUP_CLASS, SEGMENT_ITEM_CLASS } from './segment-classes';

function ratioTestId(id: string): string {
  return `settings-default-ratio-${id.replace(':', 'x')}`;
}

/**
 * 「生成参数」卡(ui-parity 07-03 P2):默认比例/质量,与 Composer 同一目录与质量口径。
 * 修改经偏好通道即时生效;工作台未显式改过的草稿会同步继承。
 */
export function GenerationDefaultsCard() {
  const preferences = usePreferences();
  const updatePreferences = useUpdatePreferences();

  return (
    <Card data-testid="settings-generation-defaults-card">
      <CardHeader>
        <CardTitle>生成参数</CardTitle>
        <CardDescription>
          设置新设计默认使用的画幅与质量;修改会同步应用到当前工作台草稿
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {preferences.isPending ? (
          <Skeleton className="h-9 w-full" data-testid="settings-generation-defaults-loading" />
        ) : preferences.isError ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-destructive text-sm">偏好读取失败,请重试</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void preferences.refetch()}
              data-testid="settings-generation-defaults-retry"
            >
              重试
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="settings-default-ratio">默认比例</Label>
                <p className="mt-1 text-muted-foreground text-xs">与工作台一致的画幅目录</p>
              </div>
              <Select
                value={preferences.data.defaultAspectRatio}
                onValueChange={(value) => updatePreferences.mutate({ defaultAspectRatio: value })}
              >
                <SelectTrigger
                  id="settings-default-ratio"
                  className="w-44 shrink-0"
                  data-testid="settings-default-ratio-trigger"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RATIO_CATALOG.map((option) => (
                    <SelectItem
                      key={option.id}
                      value={option.id}
                      data-testid={ratioTestId(option.id)}
                    >
                      {option.id} · {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Separator />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <Label>默认质量</Label>
                <p className="mt-1 text-muted-foreground text-xs">
                  文案与工作台一致:自动 / 标准 / 高清 / 超清
                </p>
              </div>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={preferences.data.defaultQuality}
                onValueChange={(value) => {
                  if (!value) return;
                  updatePreferences.mutate({ defaultQuality: value as GenerationQuality });
                }}
                aria-label="默认质量"
                data-testid="settings-default-quality"
                className={SEGMENT_GROUP_CLASS}
              >
                {QUALITY_OPTIONS.map((option) => (
                  <ToggleGroupItem
                    key={option.id}
                    value={option.id}
                    aria-label={option.label}
                    data-testid={`settings-default-quality-${option.id}`}
                    className={SEGMENT_ITEM_CLASS}
                  >
                    {option.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
