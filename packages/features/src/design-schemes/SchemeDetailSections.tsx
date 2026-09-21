'use client';

import type { DesignSchemeRevisionDocument, DesignSchemeSummary } from '@musefold/contracts';
import { ExternalLink, FileCheck2, Pencil, ShieldCheck, Trash2, Undo2 } from '@musefold/ui/icons';
import { cn } from '@musefold/ui/lib/utils';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import {
  CONSTRAINT_DOMAIN_LABEL,
  CONSTRAINT_MODE_LABEL,
  FIDELITY_LABEL,
  IMAGE_ROLE_LABEL,
  INPUT_KIND_LABEL,
  SOURCE_KIND_LABEL,
} from './scheme-labels';

/** 分节容器(承旧 DetailSection):顶部分隔 + 标题行 + 可选动作。 */
export function DetailSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-border border-t pt-5">
      <div className="flex min-h-7 items-center justify-between gap-3">
        <h2 className="font-semibold text-sm text-foreground">{title}</h2>
        {action}
      </div>
      <div className="mt-3 text-[12px] text-muted-foreground leading-6">{children}</div>
    </section>
  );
}

/** 输入槽位编辑态(草稿限定):staged 修改,保存时一次性生成新 revision。 */
export type SchemeInputEdit = { id: string; required: boolean; removed: boolean };

/**
 * 详情文档分节(承旧 SchemeRuntimeDocumentSections):
 * 需要提供(view/staged edit)/ 方案规则 / 来源与版本 / 技术详情(折叠)。
 */
export function SchemeDetailSections({
  scheme,
  document,
  inputEdits,
  setInputEdits,
  inputSaveBusy,
  inputEditsDirty,
  templateBoundIds,
  beginInputEdit,
  saveInputEdits,
}: {
  scheme: DesignSchemeSummary;
  document: DesignSchemeRevisionDocument;
  inputEdits: SchemeInputEdit[] | null;
  setInputEdits: Dispatch<SetStateAction<SchemeInputEdit[] | null>>;
  inputSaveBusy: boolean;
  inputEditsDirty: boolean;
  templateBoundIds: Set<string>;
  beginInputEdit(): void;
  saveInputEdits(): void | Promise<void>;
}) {
  const repoSource = document.sources.find(
    (source) => source.kind.startsWith('github') && (source.uri ?? source.repositoryUrl),
  );
  const repoUrl = repoSource?.uri ?? repoSource?.repositoryUrl ?? null;

  return (
    <div className="mt-10 space-y-7">
      <DetailSection
        title="需要提供"
        action={
          scheme.status === 'draft' && document.inputs.length > 0 && !inputEdits ? (
            <button
              type="button"
              onClick={beginInputEdit}
              disabled={inputSaveBusy}
              className="inline-flex min-h-7 items-center gap-1.5 rounded-md px-2 font-medium text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              data-testid="runtime-scheme-edit-inputs"
            >
              <Pencil className="size-3" aria-hidden />
              编辑
            </button>
          ) : undefined
        }
      >
        {document.inputs.length === 0 ? (
          <p>这个方案不需要额外输入，直接运行即可。</p>
        ) : !inputEdits ? (
          <div className="divide-y divide-border">
            {document.inputs.map((input) => (
              <div
                key={input.id}
                className="grid grid-cols-[minmax(120px,0.55fr)_minmax(0,1fr)_auto] items-center gap-3 py-2.5"
              >
                <span className="font-medium text-foreground">
                  {input.kind === 'text' ? `@${input.label}` : input.label}
                </span>
                <span className="min-w-0 truncate">
                  {input.description ||
                    (input.imageRole
                      ? IMAGE_ROLE_LABEL[input.imageRole]
                      : INPUT_KIND_LABEL[input.kind])}
                </span>
                <span className="text-muted-foreground">
                  {INPUT_KIND_LABEL[input.kind]} · {input.required ? '必需' : '可选'}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div data-testid="runtime-scheme-inputs-editor">
            <div className="divide-y divide-border">
              {document.inputs.map((input) => {
                const edit = inputEdits.find((item) => item.id === input.id);
                if (!edit) return null;
                const deletable = !templateBoundIds.has(input.id);
                return (
                  <div
                    key={input.id}
                    className={cn(
                      'grid grid-cols-[minmax(120px,0.55fr)_minmax(0,1fr)_auto] items-center gap-3 py-2.5',
                      edit.removed && 'opacity-50',
                    )}
                    data-testid={`runtime-scheme-input-row-${input.id}`}
                    data-removed={edit.removed || undefined}
                  >
                    <span
                      className={cn('font-medium text-foreground', edit.removed && 'line-through')}
                    >
                      {input.kind === 'text' ? `@${input.label}` : input.label}
                    </span>
                    <span className="min-w-0 truncate">
                      {input.description ||
                        (input.imageRole
                          ? IMAGE_ROLE_LABEL[input.imageRole]
                          : INPUT_KIND_LABEL[input.kind])}
                    </span>
                    <span className="flex items-center gap-1.5">
                      {edit.removed ? (
                        <button
                          type="button"
                          onClick={() =>
                            setInputEdits((prev) =>
                              (prev ?? []).map((item) =>
                                item.id === input.id ? { ...item, removed: false } : item,
                              ),
                            )
                          }
                          className="inline-flex min-h-7 items-center gap-1 rounded-md px-2 font-medium text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          data-testid={`runtime-scheme-input-restore-${input.id}`}
                        >
                          <Undo2 className="size-3" aria-hidden />
                          恢复
                        </button>
                      ) : (
                        <>
                          <div
                            className="flex rounded-md bg-muted p-0.5"
                            role="radiogroup"
                            aria-label={`${input.label}是否必需`}
                          >
                            {([true, false] as const).map((value) => (
                              <button
                                key={String(value)}
                                type="button"
                                role="radio"
                                aria-checked={edit.required === value}
                                onClick={() =>
                                  setInputEdits((prev) =>
                                    (prev ?? []).map((item) =>
                                      item.id === input.id ? { ...item, required: value } : item,
                                    ),
                                  )
                                }
                                className={cn(
                                  'min-h-6 rounded-[5px] px-2 font-medium text-[11px] transition-colors',
                                  edit.required === value
                                    ? 'bg-card text-foreground shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground',
                                )}
                                data-testid={`runtime-scheme-input-${value ? 'required' : 'optional'}-${input.id}`}
                              >
                                {value ? '必需' : '可选'}
                              </button>
                            ))}
                          </div>
                          <button
                            type="button"
                            disabled={!deletable}
                            onClick={() =>
                              setInputEdits((prev) =>
                                (prev ?? []).map((item) =>
                                  item.id === input.id ? { ...item, removed: true } : item,
                                ),
                              )
                            }
                            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
                            title={deletable ? '删除这个输入' : '被方案提示词模板引用，不能删除'}
                            aria-label={`删除${input.label}`}
                            data-testid={`runtime-scheme-input-delete-${input.id}`}
                          >
                            <Trash2 className="size-3.5" aria-hidden />
                          </button>
                        </>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 border-border border-t pt-3">
              <span className="text-[11px] text-muted-foreground">
                保存后生成新版本，需要重新试运行才能设为正式。
              </span>
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setInputEdits(null)}
                  className="min-h-7 rounded-md px-2.5 font-medium text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  data-testid="runtime-scheme-inputs-cancel"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={!inputEditsDirty || inputSaveBusy}
                  onClick={() => void saveInputEdits()}
                  className="inline-flex min-h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 font-semibold text-[11px] text-primary-foreground transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="runtime-scheme-inputs-save"
                >
                  保存更改
                </button>
              </span>
            </div>
          </div>
        )}
      </DetailSection>

      <DetailSection title="方案规则">
        {document.constraints.length === 0 ? (
          <p>没有额外的视觉约束。</p>
        ) : (
          <ul className="space-y-1.5">
            {document.constraints.map((constraint) => (
              <li key={constraint.id} className="flex items-start gap-2.5">
                <span
                  className={cn(
                    'mt-0.5 shrink-0 rounded-full border px-1.5 py-0.5 text-[11px]',
                    constraint.mode === 'required'
                      ? 'border-primary/35 bg-primary/10 text-primary'
                      : constraint.mode === 'avoid'
                        ? 'border-destructive/30 text-destructive'
                        : 'border-border text-muted-foreground',
                  )}
                >
                  {CONSTRAINT_DOMAIN_LABEL[constraint.domain]} ·{' '}
                  {CONSTRAINT_MODE_LABEL[constraint.mode]}
                </span>
                <span className="min-w-0">{constraint.statement}</span>
              </li>
            ))}
          </ul>
        )}
      </DetailSection>

      <DetailSection title="来源与版本">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <span className="block text-muted-foreground">来源</span>
            <span className="mt-0.5 block text-foreground">
              {scheme.sourcePresentation === 'skill' ? 'Skill' : 'Musefold 创建'}
            </span>
          </div>
          <div>
            <span className="block text-muted-foreground">还原度</span>
            <span className="mt-0.5 block text-foreground">
              {FIDELITY_LABEL[document.fidelity] ?? document.fidelity}
            </span>
          </div>
          <div>
            <span className="block text-muted-foreground">本机状态</span>
            <span className="mt-0.5 block text-foreground">
              {scheme.hasSuccessfulTrial ? '已验证' : '等待试运行'}
            </span>
          </div>
        </div>
        {document.sources.length > 0 ? (
          <ul className="mt-4 space-y-1 border-border border-t pt-3">
            {document.sources.map((source) => (
              <li key={source.id} className="flex items-center gap-2 text-[11px]">
                <span className="shrink-0 text-muted-foreground">
                  {SOURCE_KIND_LABEL[source.kind]}
                </span>
                <span className="min-w-0 truncate text-foreground">
                  {source.uri ?? source.repositoryUrl ?? '—'}
                </span>
                {(source.resolvedRef ?? source.ref) ? (
                  <span className="shrink-0 text-muted-foreground">
                    @{source.resolvedRef ?? source.ref}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </DetailSection>

      <details className="border-border border-t pt-5" data-testid="runtime-scheme-tech-details">
        <summary className="cursor-pointer font-semibold text-sm text-foreground">技术详情</summary>
        <div className="mt-4 space-y-3 text-[11px] text-muted-foreground leading-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <span className="block text-muted-foreground">编译模型</span>
              <span className="mt-0.5 block text-foreground">
                {document.compilation.model.model}
                {document.compilation.model.connectionName
                  ? ` · ${document.compilation.model.connectionName}`
                  : ''}
              </span>
            </div>
            <div>
              <span className="block text-muted-foreground">提示词模块</span>
              <span className="mt-0.5 block text-foreground">
                {document.promptProgram.length} 个（版本 {document.revisionId.slice(0, 12)}）
              </span>
            </div>
          </div>
          {document.compilation.adopted.length > 0 ? (
            <div>
              <p className="flex items-center gap-1.5 font-medium text-foreground">
                <FileCheck2 className="size-3.5 text-success" aria-hidden />
                采用了
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {document.compilation.adopted.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {document.compilation.omitted.length > 0 ? (
            <div>
              <p className="font-medium text-foreground">舍弃了</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {document.compilation.omitted.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {document.compilation.warnings.length > 0 ? (
            <div>
              <p className="font-medium text-warning">注意</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {document.compilation.warnings.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="flex items-center gap-2">
            <ShieldCheck className="size-3.5 text-success" aria-hidden />
            来源快照已锁定，不会执行仓库脚本
          </p>
          {repoUrl ? (
            <a
              href={repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 pt-1 text-primary hover:underline"
            >
              <ExternalLink className="size-3.5" aria-hidden />
              查看 GitHub 仓库
            </a>
          ) : null}
        </div>
      </details>
    </div>
  );
}
