import { GitBranch, Loader2, ShieldCheck, X } from '../../../components/ui/icons';
import { cn } from '../../../lib/utils';
import { useSkillRuntimeStore } from './skill-runtime-store';
import { useGenerationStore } from '../store';

export function SkillRuntimeAttachment() {
  const status = useSkillRuntimeStore((state) => state.status);
  const sourceUrl = useSkillRuntimeStore((state) => state.sourceUrl);
  const attachment = useSkillRuntimeStore((state) => state.attachment);
  const error = useSkillRuntimeStore((state) => state.error);
  const remove = useSkillRuntimeStore((state) => state.remove);
  const activeProvider = useGenerationStore((state) => (
    state.providers.find((provider) => provider.id === state.activeProviderId) ?? state.providers[0] ?? null
  ));
  const directToDoubao = activeProvider?.type === 'doubao-web';
  if (status === 'idle' || status === 'executing' || status === 'complete') return null;

  const repository = sourceUrl?.replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '') ?? 'GitHub Skill';
  const busy = status === 'detecting';
  const detail = status === 'detecting'
    ? directToDoubao ? '正在读取待转发的 Skill' : '正在识别图像能力'
    : error
        ? error
        : directToDoubao
          ? `豆包直传 · ${attachment?.textFileCount ?? 0} 个文本 · 不调用 Agent`
          : `${attachment?.textFileCount ?? 0} 个文本 · ${attachment?.usableImageCount ?? 0} 张可用图片`;

  return (
    <div className="flex h-12 min-w-[264px] max-w-[360px] items-center gap-2.5 rounded-lg border border-accent/35 bg-popover px-2.5" data-testid="skill-runtime-chip" data-status={status}>
      <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
        <GitBranch className="h-3.5 w-3.5" />
        {busy && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse rounded-full bg-accent" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-meta font-medium text-primary">{attachment?.name || repository}</span>
        <span className={cn('mt-0.5 flex min-w-0 items-center gap-1 text-meta', error ? 'text-danger' : 'text-accent')}>
          {busy ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : <ShieldCheck className="h-3 w-3 shrink-0" />}
          <span className="truncate">{detail}</span>
        </span>
      </span>
      <button type="button" onClick={() => void remove()} className="icon-action h-7 w-7 shrink-0" aria-label="移除 GitHub Skill" title="移除"><X className="h-3.5 w-3.5" /></button>
    </div>
  );
}
