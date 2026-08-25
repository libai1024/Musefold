import { type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { ExternalLink, FileCheck2, Pencil, ShieldCheck, Trash2, Undo2 } from '../../components/ui/icons';
import { cn } from '../../lib/utils';
import type { DesignSchemeSummary } from '@musefold/desktop-contracts/design-scheme';
import type { DesignSchemeRevisionDocument } from '@musefold/desktop-contracts/design-scheme/schema';
import {
  CONSTRAINT_DOMAIN_LABEL,
  CONSTRAINT_MODE_LABEL,
  FIDELITY_LABEL,
  IMAGE_ROLE_LABEL,
  INPUT_KIND_LABEL,
  SOURCE_KIND_LABEL,
} from './scheme-runtime-labels';

export function DetailSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-border-subtle pt-5">
      <div className="flex min-h-7 items-center justify-between gap-3">
        <h2 className="text-[13px] font-semibold text-primary">{title}</h2>
        {action}
      </div>
      <div className="mt-3 text-[11.5px] leading-6 text-secondary">{children}</div>
    </section>
  );
}

export type SchemeInputEdit = { id: string; required: boolean; removed: boolean };

export function SchemeRuntimeDocumentSections({
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
  document: DesignSchemeRevisionDocument | null;
  inputEdits: SchemeInputEdit[] | null;
  setInputEdits: Dispatch<SetStateAction<SchemeInputEdit[] | null>>;
  inputSaveBusy: boolean;
  inputEditsDirty: boolean;
  templateBoundIds: Set<string>;
  beginInputEdit: () => void;
  saveInputEdits: () => void | Promise<void>;
}) {
  const repoSource = document?.sources.find((source) => source.kind.startsWith('github') && source.uri);

  return (
    <>
      {document && (
          <div className="mt-10 space-y-7">
            <DetailSection
              title="需要提供"
              action={scheme.status === 'draft' && document.inputs.length > 0 && !inputEdits ? (
                <button
                  type="button"
                  onClick={beginInputEdit}
                  className="inline-flex min-h-7 items-center gap-1.5 rounded-md px-2 text-meta font-medium text-secondary transition-colors hover:bg-hover hover:text-primary"
                  data-testid="runtime-scheme-edit-inputs"
                >
                  <Pencil className="h-3 w-3" />编辑
                </button>
              ) : undefined}
            >
              {document.inputs.length === 0 ? (
                <p>这个方案不需要额外输入，直接运行即可。</p>
              ) : !inputEdits ? (
                <div className="divide-y divide-border-subtle">
                  {document.inputs.map((input) => (
                    <div key={input.id} className="grid grid-cols-[minmax(120px,0.55fr)_minmax(0,1fr)_auto] items-center gap-3 py-2.5">
                      <span className="font-medium text-primary">{input.kind === 'text' ? `@${input.label}` : input.label}</span>
                      <span className="min-w-0 truncate">
                        {input.description || (input.imageRole ? IMAGE_ROLE_LABEL[input.imageRole] : INPUT_KIND_LABEL[input.kind])}
                      </span>
                      <span className="text-tertiary">{INPUT_KIND_LABEL[input.kind]} · {input.required ? '必需' : '可选'}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div data-testid="runtime-scheme-inputs-editor">
                  <div className="divide-y divide-border-subtle">
                    {document.inputs.map((input) => {
                      const edit = inputEdits.find((item) => item.id === input.id);
                      if (!edit) return null;
                      const deletable = !templateBoundIds.has(input.id);
                      return (
                        <div
                          key={input.id}
                          className={cn(
                            'grid grid-cols-[minmax(120px,0.55fr)_minmax(0,1fr)_auto] items-center gap-3 py-2.5',
                            edit.removed && 'opacity-45',
                          )}
                          data-testid={`runtime-scheme-input-row-${input.id}`}
                          data-removed={edit.removed || undefined}
                        >
                          <span className={cn('font-medium text-primary', edit.removed && 'line-through')}>
                            {input.kind === 'text' ? `@${input.label}` : input.label}
                          </span>
                          <span className="min-w-0 truncate">
                            {input.description || (input.imageRole ? IMAGE_ROLE_LABEL[input.imageRole] : INPUT_KIND_LABEL[input.kind])}
                          </span>
                          <span className="flex items-center gap-1.5">
                            {edit.removed ? (
                              <button
                                type="button"
                                onClick={() => setInputEdits((prev) => prev!.map((item) => item.id === input.id ? { ...item, removed: false } : item))}
                                className="inline-flex min-h-7 items-center gap-1 rounded-md px-2 text-meta font-medium text-secondary hover:bg-hover hover:text-primary"
                                data-testid={`runtime-scheme-input-restore-${input.id}`}
                              >
                                <Undo2 className="h-3 w-3" />恢复
                              </button>
                            ) : (
                              <>
                                <div className="flex rounded-md bg-inset p-0.5" role="radiogroup" aria-label={`${input.label}是否必需`}>
                                  {([true, false] as const).map((value) => (
                                    <button
                                      key={String(value)}
                                      type="button"
                                      role="radio"
                                      aria-checked={edit.required === value}
                                      onClick={() => setInputEdits((prev) => prev!.map((item) => item.id === input.id ? { ...item, required: value } : item))}
                                      className={cn(
                                        'min-h-6 rounded-[5px] px-2 text-meta font-medium transition-colors',
                                        edit.required === value ? 'bg-elevated text-primary shadow-sm' : 'text-tertiary hover:text-primary',
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
                                  onClick={() => setInputEdits((prev) => prev!.map((item) => item.id === input.id ? { ...item, removed: true } : item))}
                                  className="icon-action h-7 w-7 disabled:cursor-not-allowed disabled:opacity-35"
                                  title={deletable ? '删除这个输入' : '被方案提示词模板引用，不能删除'}
                                  aria-label={`删除${input.label}`}
                                  data-testid={`runtime-scheme-input-delete-${input.id}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 border-t border-border-subtle pt-3">
                    <span className="text-meta text-tertiary">保存后生成新版本，需要重新试运行才能设为正式。</span>
                    <span className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setInputEdits(null)}
                        className="min-h-7 rounded-md px-2.5 text-meta font-medium text-secondary hover:bg-hover hover:text-primary"
                        data-testid="runtime-scheme-inputs-cancel"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        disabled={!inputEditsDirty || inputSaveBusy}
                        onClick={() => void saveInputEdits()}
                        className="inline-flex min-h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-meta font-semibold text-background hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-45"
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
                          'mt-0.5 shrink-0 rounded-full border px-1.5 py-0.5 text-meta',
                          constraint.mode === 'required'
                            ? 'border-accent/35 bg-accent-soft text-accent'
                            : constraint.mode === 'avoid'
                              ? 'border-danger/30 text-danger'
                              : 'border-border-subtle text-secondary',
                        )}
                      >
                        {CONSTRAINT_DOMAIN_LABEL[constraint.domain]} · {CONSTRAINT_MODE_LABEL[constraint.mode]}
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
                  <span className="block text-tertiary">来源</span>
                  <span className="mt-0.5 block text-primary">{scheme.sourcePresentation === 'skill' ? 'Skill' : 'Musefold 创建'}</span>
                </div>
                <div>
                  <span className="block text-tertiary">还原度</span>
                  <span className="mt-0.5 block text-primary">{FIDELITY_LABEL[document.fidelity] ?? document.fidelity}</span>
                </div>
                <div>
                  <span className="block text-tertiary">本机状态</span>
                  <span className="mt-0.5 block text-primary">{scheme.hasSuccessfulTrial ? '已验证' : '等待试运行'}</span>
                </div>
              </div>
              {document.sources.length > 0 && (
                <ul className="mt-4 space-y-1 border-t border-border-subtle pt-3">
                  {document.sources.map((source) => (
                    <li key={source.id} className="flex items-center gap-2 text-[11px]">
                      <span className="shrink-0 text-tertiary">{SOURCE_KIND_LABEL[source.kind]}</span>
                      <span className="min-w-0 truncate text-primary">{source.uri ?? source.filePath ?? '—'}</span>
                      {source.ref && <span className="shrink-0 text-tertiary">@{source.ref}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </DetailSection>

            <details className="border-t border-border-subtle pt-5" data-testid="runtime-scheme-tech-details">
              <summary className="cursor-pointer text-[13px] font-semibold text-primary">技术详情</summary>
              <div className="mt-4 space-y-3 text-[11px] leading-6 text-secondary">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <span className="block text-tertiary">编译模型</span>
                    <span className="mt-0.5 block text-primary">
                      {document.compilation.model.model}
                      {document.compilation.model.connectionName ? ` · ${document.compilation.model.connectionName}` : ''}
                    </span>
                  </div>
                  <div>
                    <span className="block text-tertiary">提示词模块</span>
                    <span className="mt-0.5 block text-primary">{document.promptProgram.length} 个（版本 {document.revisionId.slice(0, 12)}）</span>
                  </div>
                </div>
                {document.compilation.adopted.length > 0 && (
                  <div>
                    <p className="flex items-center gap-1.5 font-medium text-primary"><FileCheck2 className="h-3.5 w-3.5 text-success" />采用了</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5">{document.compilation.adopted.map((item, index) => <li key={index}>{item}</li>)}</ul>
                  </div>
                )}
                {document.compilation.omitted.length > 0 && (
                  <div>
                    <p className="font-medium text-primary">舍弃了</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5">{document.compilation.omitted.map((item, index) => <li key={index}>{item}</li>)}</ul>
                  </div>
                )}
                {document.compilation.warnings.length > 0 && (
                  <div>
                    <p className="font-medium text-warning">注意</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5">{document.compilation.warnings.map((item, index) => <li key={index}>{item}</li>)}</ul>
                  </div>
                )}
                <p className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5 text-success" />来源快照已锁定，不会执行仓库脚本</p>
                {repoSource?.uri && (
                  <button
                    type="button"
                    onClick={() => window.open(repoSource.uri, '_blank', 'noopener,noreferrer')}
                    className="inline-flex items-center gap-1.5 pt-1 text-primary hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />查看 GitHub 仓库
                  </button>
                )}
              </div>
            </details>
          </div>
      )}
    </>
  );
}
