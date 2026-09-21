'use client';

import type { GenerationJob } from '@musefold/contracts';
import { FadeImage } from '@musefold/ui/components/fade-image';
import { Skeleton } from '@musefold/ui/components/skeleton';
import { ImageOff } from '@musefold/ui/icons';
import { usePromptRelatedWorks } from './hooks';

/** 单格缩略;宿主接了切屏才可点(否则只读画廊,不留死链接)。 */
function WorkThumb({
  job,
  onOpenWork,
}: {
  job: GenerationJob;
  onOpenWork?(job: GenerationJob): void;
}) {
  const asset = job.assets[0];
  if (!asset) return null;
  const image = (
    <FadeImage src={asset.url} alt={job.request.prompt} className="size-full object-cover" />
  );
  if (!onOpenWork) {
    return (
      <div
        className="aspect-square overflow-hidden rounded-md border border-border bg-muted"
        data-testid="prompt-detail-work"
      >
        {image}
      </div>
    );
  }
  return (
    <button
      type="button"
      className="aspect-square overflow-hidden rounded-md border border-border bg-muted transition-opacity hover:opacity-90"
      data-testid="prompt-detail-work"
      aria-label="查看生成记录"
      onClick={() => onOpenWork(job)}
    >
      {image}
    </button>
  );
}

export interface PromptRelatedWorksProps {
  promptId: string;
  /**
   * 点击缩略跳历史屏并选中该回合(意图经 screen-intent-store 传递)。
   * 宿主未注入切屏回调时不传 —— 缩略退成只读画廊,不留死链接。
   */
  onOpenWork?(job: GenerationJob): void;
}

/**
 * 详情「相关作品」(承旧 PromptWorksPanel):该提示词生成过的成图缩略格。
 * 数据为反向查询 —— 生成回合上带 promptId,服务端按 promptId + succeeded 过滤。
 */
export function PromptRelatedWorks({ promptId, onOpenWork }: PromptRelatedWorksProps) {
  const works = usePromptRelatedWorks(promptId);
  const jobs = works.data ?? [];

  return (
    <section className="flex flex-col gap-2" data-testid="prompt-detail-works">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium text-muted-foreground text-xs">相关作品</span>
        {jobs.length > 0 && (
          <span className="text-[11px] text-muted-foreground/80 tabular-nums">{jobs.length}</span>
        )}
      </div>

      {works.isPending && works.fetchStatus !== 'idle' ? (
        <div className="grid grid-cols-3 gap-1.5" data-testid="prompt-detail-works-loading">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="aspect-square rounded-md" />
          ))}
        </div>
      ) : works.isError ? (
        <p className="text-destructive text-xs" data-testid="prompt-detail-works-error">
          作品加载失败
        </p>
      ) : jobs.length === 0 ? (
        <p
          className="flex items-center gap-1.5 text-muted-foreground text-xs"
          data-testid="prompt-detail-works-empty"
        >
          <ImageOff className="size-3.5" aria-hidden /> 还没有用它生成过作品
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {jobs.map((job) => (
            <WorkThumb key={job.id} job={job} onOpenWork={onOpenWork} />
          ))}
        </div>
      )}
    </section>
  );
}
