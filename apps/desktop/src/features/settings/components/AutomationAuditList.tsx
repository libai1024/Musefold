// 设置 · 开放能力 — 「最近调用」审计列表(自 AutomationSection 拆出)。
// 连续 hairline 表面 + 点击行展开完整 promptText 的交互模型不变(有意设计)。
// a11y:行是 <button>,内部只放 phrasing content(span + CSS block),并带 aria-expanded。
import { useState } from 'react';
import type { AutomationSpendAudit } from '@musefold/desktop-contracts/ipc';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';
import { formatAuditTime } from './automation-format';

const AUDIT_ACTION_LABEL: Record<string, string> = {
  generate_image: '生图',
  run_scheme: '方案',
  run_github_skill: 'Skill',
};
const AUDIT_STATUS_LABEL: Record<string, string> = {
  success: '成功',
  failed: '失败',
  cancelled: '取消',
  denied: '已拒绝',
  timeout: '超时',
};
const AUDIT_VIA_LABEL: Record<string, string> = {
  budget: '预算',
  confirmation: '确认卡',
  consent: '终端确认',
  'idempotent-replay': '幂等重放',
  denied: '—',
  timeout: '—',
};

interface AutomationAuditListProps {
  audit: AutomationSpendAudit[];
  onRefresh: () => void;
}

export function AutomationAuditList({ audit, onRefresh }: AutomationAuditListProps) {
  const [expandedAuditId, setExpandedAuditId] = useState<number | null>(null);

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between">
        <h3 className="m-0 text-[12.5px] font-medium text-primary">最近调用</h3>
        <Button variant="ghost" size="xs" onClick={onRefresh}>
          刷新
        </Button>
      </div>
      {audit.length === 0 ? (
        <p
          className="settings-audit-empty mt-3 text-[11.5px] text-quaternary"
          data-testid="automation-audit-empty"
        >
          还没有外部调用记录。
        </p>
      ) : (
        <div className="settings-audit-list mt-3" data-testid="automation-audit-list">
          {audit.map((entry) => (
            <button
              type="button"
              key={entry.id}
              onClick={() =>
                setExpandedAuditId((current) => (current === entry.id ? null : entry.id))
              }
              aria-expanded={expandedAuditId === entry.id}
              aria-controls={`audit-detail-${entry.id}`}
              className="settings-audit-item no-drag text-[11px]"
            >
              <span className="flex items-center gap-3">
                <span
                  className={cn(
                    'w-12 shrink-0 font-medium',
                    entry.status === 'success' ? 'text-tertiary' : 'settings-audit-status-danger',
                  )}
                >
                  {AUDIT_STATUS_LABEL[entry.status] ?? entry.status}
                </span>
                <span className="w-20 shrink-0 font-mono text-quaternary">
                  {AUDIT_ACTION_LABEL[entry.action] ?? entry.action}
                </span>
                <span className="min-w-0 flex-1 truncate text-secondary">
                  {entry.promptText ? entry.promptText.slice(0, 60) : '—'}
                </span>
                <span className="shrink-0 text-quaternary tabular-nums">
                  {entry.actualPoints != null ? `${entry.actualPoints} 积分` : '-'}
                </span>
                <span className="shrink-0 text-quaternary">
                  {AUDIT_VIA_LABEL[entry.approvedVia] ?? entry.approvedVia}
                </span>
                <span className="shrink-0 text-quaternary tabular-nums">
                  {formatAuditTime(entry.at)}
                </span>
              </span>
              {expandedAuditId === entry.id && entry.promptText && (
                <span
                  id={`audit-detail-${entry.id}`}
                  className="settings-audit-detail block whitespace-pre-wrap break-words font-mono text-meta text-secondary"
                >
                  {entry.promptText}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
