import { useEffect, useState } from 'react';
import type { SkillRuntimeTraceItem } from '@shared/types/skill-runtime';
import { Check, ChevronDown, GitBranch, Loader2, ShieldCheck, X } from '../../../components/ui/icons';
import { cn } from '../../../lib/utils';
import { useSkillRuntimeStore } from './skillRuntimeStore';
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
        <span className="block truncate text-[10.5px] font-medium text-primary">{attachment?.name || repository}</span>
        <span className={cn('mt-0.5 flex min-w-0 items-center gap-1 text-[9.5px]', error ? 'text-danger' : 'text-accent')}>
          {busy ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : <ShieldCheck className="h-3 w-3 shrink-0" />}
          <span className="truncate">{detail}</span>
        </span>
      </span>
      <button type="button" onClick={() => void remove()} className="icon-action h-7 w-7 shrink-0" aria-label="移除 GitHub Skill" title="移除"><X className="h-3.5 w-3.5" /></button>
    </div>
  );
}

export function SkillRuntimeConversation({ trace, runningLabel = '正在执行 Skill', doneLabel = '已完成 Skill 调用' }: {
  trace: SkillRuntimeTraceItem[];
  runningLabel?: string;
  doneLabel?: string;
}) {
  const running = trace.some((item) => item.status === 'running');
  const [expanded, setExpanded] = useState(true);
  useEffect(() => {
    if (running) setExpanded(true);
  }, [running]);
  if (trace.length === 0) return null;
  return (
    <div className="mb-3" data-testid="skill-runtime-conversation" data-placement="conversation">
      <button type="button" onClick={() => setExpanded(!expanded)} className="flex min-h-8 w-full items-center gap-2 text-left" aria-expanded={expanded}>
        {running ? <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" /> : <Check className="h-3.5 w-3.5 text-success" />}
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-primary">{running ? runningLabel : doneLabel}</span>
        <span className="text-[9.5px] text-tertiary">{trace.length} 步</span>
        <ChevronDown className={cn('h-3.5 w-3.5 text-tertiary transition-transform', expanded && 'rotate-180')} />
      </button>
      {expanded && (
        <div className="ml-[6px] pl-[17px]" data-testid="skill-runtime-conversation-items">
          {trace.map((item, index) => (
            <div key={item.id} className="relative py-1.5" data-trace-status={item.status}>
              {/* 连接线只在相邻两点之间：首步从点心向下、末步到点心为止；单步不画线。
                  点用 rem 尺寸（top-2 + h-3.5 → 圆心 0.9375rem），线的端点与水平位置同基准。 */}
              {trace.length > 1 && (
                <span
                  aria-hidden
                  className={cn(
                    'absolute left-[calc(0.4375rem-23.5px)] w-px bg-border-default',
                    index === 0 ? 'bottom-0 top-[0.9375rem]' : index === trace.length - 1 ? 'top-0 h-[0.9375rem]' : 'bottom-0 top-0',
                  )}
                />
              )}
              <span className={cn(
                'absolute -left-[23px] top-2 flex h-3.5 w-3.5 items-center justify-center rounded-full border bg-background',
                item.status === 'running' ? 'border-accent text-accent' : item.status === 'error' ? 'border-danger text-danger' : item.status === 'warning' ? 'border-warning text-warning' : 'border-success text-success',
              )}>
                {item.status === 'running' ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Check className="h-2.5 w-2.5" />}
              </span>
              <div className="min-w-0 pl-0.5">
                <div className="flex items-center gap-2 text-[10.5px] text-primary">
                  <span className="font-medium">{item.title}</span>
                  {typeof item.durationMs === 'number' && <span className="text-[9px] text-quaternary">{item.durationMs}ms</span>}
                  <span className="ml-auto text-[9px] text-quaternary">{item.kind === 'assistant' ? (item.title.includes('Agent') ? 'Agent 返回' : '转发提示词') : item.kind === 'tool' ? '工具' : `步骤 ${index + 1}`}</span>
                </div>
                {item.detail && <p className="mt-0.5 break-words text-[9.5px] leading-relaxed text-tertiary">{item.detail}</p>}
                {item.kind === 'assistant' && item.title === 'Agent' ? (
                  // Agent 的流式说明：作为对话正文直接展开，随事件增量打字机式增长。
                  (item.output || item.status === 'running') && (
                    <p className="mt-1 max-h-52 overflow-y-auto whitespace-pre-wrap break-words text-[10.5px] leading-relaxed text-secondary" data-testid="skill-runtime-agent-output">
                      {item.output}
                      {item.status === 'running' && <span className="ml-0.5 inline-block h-3 w-[5px] animate-pulse rounded-[1px] bg-accent align-middle" aria-hidden />}
                    </p>
                  )
                ) : item.output ? (
                  <details className="mt-1.5 border-l-2 border-accent/35 pl-2" open>
                    <summary className="cursor-pointer text-[9.5px] font-medium text-secondary">查看完整返回内容</summary>
                    <p className="mt-1.5 max-h-28 overflow-y-auto whitespace-pre-wrap break-words text-[9.5px] leading-relaxed text-secondary" data-testid="skill-runtime-agent-output">{item.output}</p>
                  </details>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
