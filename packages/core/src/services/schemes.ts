// SchemeService 只读切面（V04-CORE-06 的 P1 部分）：list / get / compile。
// 纪律（v0.3.2 决策，延续到暴露矩阵）：草稿方案对外不可见不可调，仅「正式」方案进入目录。
// run（试运行/生图）在 P2/P3 经策略闸门接入，此处不做。

import type Database from 'better-sqlite3';
import {
  compileSchemePrompt,
  missingRequiredSlots,
  type CompiledSchemePrompt,
} from '@musefold/desktop-contracts/design-scheme/prompt-compiler';
import type { DesignSchemeRevisionDocument } from '@musefold/desktop-contracts/design-scheme/schema';
import type { DesignSchemeSummary, SchemePriorityMode } from '@musefold/desktop-contracts/design-scheme';
import { getDesignSchemeDb } from '../db/design-scheme';
import { DesignSchemeRepository } from '../db/design-scheme/repositories';
import { CoreError, notFound } from './errors';

export interface SchemeDetail {
  summary: DesignSchemeSummary;
  document: DesignSchemeRevisionDocument;
}

export interface CompileSchemeRequest {
  schemeId: string;
  /** 文本槽位值：slotId → 内容 */
  inputs?: Record<string, string>;
  brief?: string;
  /** 计划携带的参考图数量（命中图槽校验） */
  imageCount?: number;
  ratioId?: string;
  priorityMode?: SchemePriorityMode;
}

export interface CompileSchemeResult extends CompiledSchemePrompt {
  warnings: string[];
  schemeId: string;
  revisionId: string;
}

export interface SchemeService {
  /** 仅正式方案 */
  list(): DesignSchemeSummary[];
  get(schemeId: string): SchemeDetail | null;
  compile(request: CompileSchemeRequest): CompileSchemeResult;
}

export function createSchemeService(db: () => Database.Database = getDesignSchemeDb): SchemeService {
  const repo = () => new DesignSchemeRepository(db());

  const formalSummary = (schemeId: string): DesignSchemeSummary | null => {
    const summary = repo().listSummaries().find((item) => item.id === schemeId);
    return summary && summary.status === 'formal' ? summary : null;
  };

  return {
    list() {
      return repo().listSummaries().filter((summary) => summary.status === 'formal');
    },
    get(schemeId) {
      const summary = formalSummary(schemeId);
      if (!summary) return null;
      const document = repo().getRevisionDocument(summary.currentRevisionId);
      if (!document) return null;
      return { summary, document };
    },
    compile(request) {
      const summary = formalSummary(request.schemeId);
      if (!summary) throw notFound('设计方案（或方案尚未转正）', { schemeId: request.schemeId });
      const document = repo().getRevisionDocument(summary.currentRevisionId);
      if (!document) {
        throw new CoreError('INVALID_STATE', '方案修订版文档缺失', { schemeId: request.schemeId });
      }

      const inputs = request.inputs ?? {};
      const imageCount = request.imageCount ?? 0;
      const compiled = compileSchemePrompt({
        document,
        inputValues: inputs,
        brief: request.brief ?? '',
        imageCount,
        ratioId: request.ratioId ?? 'auto',
        priorityMode: request.priorityMode,
      });

      const missing = missingRequiredSlots(document, inputs, imageCount);
      return {
        ...compiled,
        warnings: [
          ...missing.map((slot) => `提醒：必填输入「${slot.label}」(${slot.id}) 未提供`),
          ...compiled.unresolvedVariables.map((name) => `提醒：模板变量「${name}」没有输入值，已按空值代入`),
        ],
        schemeId: summary.id,
        revisionId: summary.currentRevisionId,
      };
    },
  };
}
