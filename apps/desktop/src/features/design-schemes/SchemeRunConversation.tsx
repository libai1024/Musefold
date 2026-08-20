/**
 * 方案运行轮（试运行草稿 / 使用正式方案）的对话内容：
 * 确定性管线轨迹 + 试运行成功后的「设为封面 / 设为正式」操作卡。
 * 轨迹条目与 Skill 执行同构，直接复用 SkillRuntimeConversation 渲染。
 */
import type { SkillRuntimeTraceItem } from '@musefold/desktop-contracts/skill-runtime';
import type { GenerationSource } from '../generation/workbench/types';
import { SkillRuntimeConversation } from '../generation/workbench/SkillRuntimeAttachment';
import { toImageSrc } from '../../lib/media';
import { cn } from '../../lib/utils';
import { useAppStore } from '../../stores/app';
import { BadgeCheck, Check, Pencil, Wrench } from '../../components/ui/icons';
import { useSchemeCreationStore } from './creationStore';
import { useSchemeRunStore } from './runStore';

type SchemeRunSource = Extract<GenerationSource, { kind: 'scheme-run' }>;

export function SchemeRunConversation({ turnId, source }: { turnId: string; source: SchemeRunSource }) {
  const selectCover = useSchemeRunStore((state) => state.selectCover);
  const formalize = useSchemeRunStore((state) => state.formalize);
  const repairRun = useSchemeRunStore((state) => state.repairRun);
  const runStoreRunning = useSchemeRunStore((state) => state.running);
  const lastRunTurnId = useSchemeRunStore((state) => state.lastRun?.turnId ?? null);
  const attachModify = useSchemeCreationStore((state) => state.attachModify);
  const setView = useAppStore((state) => state.setView);
  const running = source.state === 'running';
  const modeLabel = source.mode === 'trial' ? '试运行' : '方案运行';
  const coverCandidates = source.generations.filter(
    (outcome) => outcome.result.status === 'success' && outcome.result.imagePath && outcome.assetId,
  );
  const showTrialActions = source.mode === 'trial' && source.state === 'succeeded' && coverCandidates.length > 0;
  // 试运行失败/无结果时也保留「返回修改」（规范 §8.2）。
  const showBackToModify = source.mode === 'trial' && source.state === 'failed';
  // 有限修复链（规范 §5.5）：只有最近一轮（上下文可复现）且未用掉建议时提供修复重跑。
  const showRepair = Boolean(source.repairHint) && !running && lastRunTurnId === turnId && !runStoreRunning;

  return (
    <div data-testid="scheme-run-conversation" data-state={source.state} data-mode={source.mode}>
      <SkillRuntimeConversation
        trace={source.trace as SkillRuntimeTraceItem[]}
        runningLabel={`正在${modeLabel} · ${source.label}`}
        doneLabel={source.state === 'succeeded' ? `${modeLabel}完成` : `${modeLabel}已结束`}
      />

      {source.error && !running && source.state !== 'cancelled' && (
        <p className="mb-3 text-[11px] text-danger" data-testid="scheme-run-error">{source.error}</p>
      )}

      {showRepair && (
        <div className="mb-3 flex max-w-[440px] items-start gap-2.5 rounded-lg border border-border-default bg-popover px-3.5 py-3" data-testid="scheme-run-repair">
          <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0 text-secondary" />
          <div className="min-w-0 flex-1">
            <p className="text-[11.5px] font-medium text-primary">质量门发现可修复的偏差</p>
            <p className="mt-0.5 text-[10.5px] leading-5 text-secondary" data-testid="scheme-run-repair-hint">{source.repairHint}</p>
          </div>
          <button
            type="button"
            onClick={() => void repairRun(turnId)}
            className="action-button shrink-0"
            data-testid="scheme-run-repair-retry"
            title="按建议重新运行一次；原始结果保留"
          >
            修复重跑
          </button>
        </div>
      )}

      {showBackToModify && (
        <div className="mb-3">
          <button
            type="button"
            onClick={() => void attachModify(source.schemeId)}
            className="action-button"
            data-testid="scheme-run-back-to-modify"
          >
            <Pencil className="h-3 w-3" /> 返回修改
          </button>
        </div>
      )}

      {showTrialActions && (
        <div className="mb-3 max-w-[440px] rounded-lg border border-border-default bg-popover p-3.5" data-testid="scheme-run-trial-actions">
          {source.formalized ? (
            <div className="flex items-center gap-2 text-[12px] text-primary" data-testid="scheme-run-formalized">
              <BadgeCheck className="h-4 w-4 text-success" />
              「{source.label}」已设为正式，可在方案中心与 Composer 中使用。
              <button type="button" onClick={() => setView('design-schemes')} className="action-button ml-auto shrink-0">查看</button>
            </div>
          ) : (
            <>
              <p className="text-[11.5px] font-medium text-primary">试运行成功，选择封面后可设为正式</p>
              <p className="mt-0.5 text-[10px] text-tertiary">试运行结果已加入草稿相册；成功不会自动转正，需要你确认。</p>
              <div className="mt-2.5 flex flex-wrap gap-2" data-testid="scheme-run-cover-candidates">
                {coverCandidates.map((outcome) => {
                  const selected = source.coverAssetId === outcome.assetId;
                  return (
                    <button
                      key={outcome.assetId}
                      type="button"
                      onClick={() => void selectCover(turnId, source.schemeId, outcome.assetId!)}
                      className={cn(
                        'group relative overflow-hidden rounded-md border p-0.5 transition-colors',
                        selected ? 'border-accent ring-1 ring-accent/40' : 'border-border-subtle hover:border-border-default',
                      )}
                      data-testid="scheme-run-cover-option"
                      data-selected={selected}
                      aria-label={selected ? '当前封面' : '设为封面'}
                      title={selected ? '当前封面' : '设为封面'}
                    >
                      <img src={toImageSrc(outcome.result.imagePath!)} alt="" className="h-16 w-16 rounded object-contain" />
                      <span className={cn(
                        'absolute bottom-1 left-1 flex items-center gap-0.5 rounded bg-black/65 px-1 py-0.5 text-[8px] leading-none text-white',
                        selected ? 'opacity-100' : 'opacity-0 transition-opacity group-hover:opacity-100',
                      )}>
                        {selected ? <><Check className="h-2.5 w-2.5" />封面</> : '设为封面'}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex items-center justify-end gap-2 border-t border-border-subtle pt-2.5">
                <button
                  type="button"
                  onClick={() => void attachModify(source.schemeId)}
                  className="action-button"
                  data-testid="scheme-run-back-to-modify"
                  title="回到修改模式继续调整方案"
                >
                  <Pencil className="h-3 w-3" /> 返回修改
                </button>
                <button
                  type="button"
                  onClick={() => void formalize(turnId, source.schemeId)}
                  disabled={!source.coverAssetId}
                  className="action-button bg-primary text-background hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40"
                  data-testid="scheme-run-formalize"
                  title={source.coverAssetId ? '设为正式' : '先选择一张封面'}
                >
                  <BadgeCheck className="h-3.5 w-3.5" /> 设为正式
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
