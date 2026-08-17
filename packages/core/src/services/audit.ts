// 花钱动作审计（V04-SEC-01 / SECURITY §3.4）：完整落库。
// 端点级请求日志仍走 NDJSON 骨架；本表只记会产生费用的动作及其放行路径。

import type Database from 'better-sqlite3';
import { getDb } from '../db/index';

export type SpendAuditAction = 'generate_image' | 'run_scheme' | 'run_github_skill';
export type SpendAuditApprovedVia =
  | 'budget'
  | 'confirmation'
  | 'consent'
  | 'idempotent-replay'
  | 'denied'
  | 'timeout';
export type SpendAuditStatus = 'success' | 'failed' | 'cancelled' | 'denied' | 'timeout';

export interface SpendAuditEntry {
  at: number;
  caller: string;
  action: SpendAuditAction;
  /** Q5 拍板：完整提示词（仅本机 SQLite；列表 UI 显示截断，点开看全文） */
  promptText: string | null;
  params: Record<string, unknown>;
  estimatedPoints: number | null;
  actualPoints: number | null;
  approvedVia: SpendAuditApprovedVia;
  status: SpendAuditStatus;
  jobId: string | null;
}

export interface SpendAuditService {
  record(entry: SpendAuditEntry): void;
  list(limit?: number): Array<SpendAuditEntry & { id: number }>;
}

export function createSpendAuditService(db: () => Database.Database = getDb): SpendAuditService {
  return {
    record(entry) {
      db()
        .prepare(
          `INSERT INTO automation_audit
             (at, caller, action, prompt_text, params_json, estimated_points, actual_points, approved_via, status, job_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          entry.at,
          entry.caller,
          entry.action,
          entry.promptText,
          JSON.stringify(entry.params),
          entry.estimatedPoints,
          entry.actualPoints,
          entry.approvedVia,
          entry.status,
          entry.jobId,
        );
    },
    list(limit = 50) {
      const rows = db()
        .prepare('SELECT * FROM automation_audit ORDER BY at DESC, id DESC LIMIT ?')
        .all(Math.max(1, Math.min(limit, 200))) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        id: row.id as number,
        at: row.at as number,
        caller: row.caller as string,
        action: row.action as SpendAuditAction,
        promptText: (row.prompt_text as string) ?? null,
        params: JSON.parse((row.params_json as string) || '{}') as Record<string, unknown>,
        estimatedPoints: (row.estimated_points as number) ?? null,
        actualPoints: (row.actual_points as number) ?? null,
        approvedVia: row.approved_via as SpendAuditApprovedVia,
        status: row.status as SpendAuditStatus,
        jobId: (row.job_id as string) ?? null,
      }));
    },
  };
}
