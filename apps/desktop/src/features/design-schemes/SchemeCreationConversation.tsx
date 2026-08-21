/**
 * 创建设计方案轮的对话内容：Agent 轨迹 + 安装确认卡片 + 草稿卡片。
 * 轨迹条目与 Skill 执行同构，直接复用 SkillRuntimeConversation 渲染。
 */
import { useEffect, useRef, useState } from 'react';
import type { SkillRuntimeTraceItem } from '@musefold/desktop-contracts/skill-runtime';
import type { GenerationSource } from '@musefold/desktop-contracts/generation-source';
import { SkillRuntimeConversation } from '../../components/SkillRuntimeConversation';
import { useSchemeCreationStore } from './creation-store';
import { useSchemeRunStore } from './run-store';
import { useAppStore } from '../../stores/app';
import { Blocks, Check, Download, FileCheck2, GitBranch, Play, ShieldCheck } from '../../components/ui/icons';

type SchemeCreationSource = Extract<GenerationSource, { kind: 'scheme-creation' }>;

const FIDELITY_LABEL: Record<string, string> = {
  verified: '已验证',
  faithful: '完整还原',
  adapted: '有取舍',
  unsupported: '暂不支持',
};

/** creationSummary 的打字机呈现：内容已最终确定，仅逐步显示。 */
function TypewriterText({ text, testId }: { text: string; testId: string }) {
  const [visible, setVisible] = useState(0);
  const textRef = useRef(text);
  useEffect(() => {
    if (textRef.current !== text) {
      textRef.current = text;
      setVisible(0);
    }
    if (visible >= text.length) return;
    const timer = window.setInterval(() => {
      setVisible((current) => Math.min(text.length, current + 4));
    }, 16);
    return () => window.clearInterval(timer);
  }, [text, visible]);
  const done = visible >= text.length;
  return (
    <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-primary" data-testid={testId} data-complete={done}>
      {text.slice(0, visible)}
      {!done && <span className="ml-0.5 inline-block h-3 w-[5px] animate-pulse rounded-[1px] bg-accent align-middle" aria-hidden />}
    </p>
  );
}

export function SchemeCreationConversation({ source }: { source: SchemeCreationSource }) {
  const confirmInstall = useSchemeCreationStore((state) => state.confirmInstall);
  const attachSchemeRun = useSchemeRunStore((state) => state.attach);
  const setView = useAppStore((state) => state.setView);
  const running = !['draft_ready', 'blocked', 'failed', 'cancelled'].includes(source.state);
  const confirmation = source.confirmation;
  const draft = source.draft;

  return (
    <div data-testid="scheme-creation-conversation" data-state={source.state}>
      <SkillRuntimeConversation
        trace={source.trace as SkillRuntimeTraceItem[]}
        runningLabel="正在创建设计方案"
        doneLabel={source.state === 'draft_ready' ? '设计方案草稿已创建' : '方案创建已结束'}
      />

      {confirmation && running && (
        <div className="mb-3 max-w-[440px] rounded-lg border border-accent/35 bg-popover p-4" data-testid="scheme-creation-confirm">
          <div className="flex items-center gap-2 text-[12px] font-semibold text-primary">
            <GitBranch className="h-3.5 w-3.5 text-accent" />
            引入来源仓库？
          </div>
          <p className="mt-1.5 break-all text-[10.5px] text-tertiary">{confirmation.repositoryUrl}</p>
          <div className="mt-3 space-y-1.5 border-y border-border-subtle py-2.5 text-[10.5px] text-secondary">
            <p className="flex items-center gap-2">
              <FileCheck2 className="h-3.5 w-3.5 text-success" />
              {confirmation.textFileCount} 个文本文件 · {confirmation.imageFileCount} 张参考图（固定 commit {confirmation.commitHash?.slice(0, 10) ?? confirmation.resolvedRef}）
            </p>
            <p className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5 text-success" />只读取内容，不会执行仓库脚本</p>
            {confirmation.license && <p className="flex items-center gap-2"><Check className="h-3.5 w-3.5" />许可证：{confirmation.license}</p>}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => void confirmInstall(false)} className="action-button" data-testid="scheme-creation-confirm-reject">取消创建</button>
            <button type="button" onClick={() => void confirmInstall(true)} className="action-button bg-primary text-background hover:opacity-85" data-testid="scheme-creation-confirm-accept">
              <Download className="h-3.5 w-3.5" /> 确认引入
            </button>
          </div>
        </div>
      )}

      {source.error && !running && source.state !== 'cancelled' && (
        <p className="mb-3 text-[11px] text-danger" data-testid="scheme-creation-error">{source.error}</p>
      )}
      {source.state === 'cancelled' && (
        <p className="mb-3 text-[11px] text-tertiary" data-testid="scheme-creation-cancelled">创建已取消，Composer 内容未丢失。</p>
      )}

      {draft && (
        <div className="space-y-3">
          <TypewriterText text={draft.creationSummary} testId="scheme-creation-summary" />
          <div className="max-w-[440px] rounded-lg border border-border-default bg-popover p-4" data-testid="scheme-creation-draft-card">
            <div className="flex items-start gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent"><Blocks className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[12.5px] font-semibold text-primary">{draft.name}</span>
                  <span className="shrink-0 rounded-full border border-border-subtle px-1.5 py-0.5 text-[9px] text-secondary">
                    {draft.status === 'formal' ? '新版本待验证' : '草稿'}
                  </span>
                  <span className="shrink-0 rounded-full border border-border-subtle px-1.5 py-0.5 text-[9px] text-secondary">{FIDELITY_LABEL[draft.fidelity] ?? draft.fidelity}</span>
                </div>
                <p className="mt-1 text-[10.5px] leading-relaxed text-secondary">{draft.summary}</p>
                {draft.inputLabels.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {draft.inputLabels.map((label) => (
                      <span key={label} className="rounded-md border border-border-subtle bg-elevated px-1.5 py-0.5 text-[9.5px] text-secondary">{label}</span>
                    ))}
                  </div>
                )}
                <p className="mt-2 text-[9.5px] text-tertiary">来源：{draft.sourceLabel}</p>
              </div>
            </div>
            <div className="mt-3 flex justify-end gap-2 border-t border-border-subtle pt-3">
              <button
                type="button"
                onClick={() => setView('design-schemes')}
                className="action-button"
                data-testid="scheme-creation-open-center"
              >
                在方案中心查看
              </button>
              <button
                type="button"
                onClick={() => void attachSchemeRun(draft, 'trial')}
                className="action-button bg-primary text-background hover:opacity-85"
                data-testid="scheme-creation-trial"
              >
                <Play className="h-3.5 w-3.5" /> 试运行
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
