/**
 * 真实设计方案详情页（v0.3.2，UI 规范 §4/§5）。
 *
 * 数据来自 design-scheme 库：版本文档（输入/规则/来源/编译记录）+ 相册资产。
 * 普通信息优先回答「能做什么、需要什么、来自哪里」；Skill 文件、commit、
 * 模型等收入折叠的「技术详情」。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Blocks,
  GitBranch,
  Pencil,
  Play,
  RefreshCw,
  Sparkles,
} from '../../components/ui/icons';
import { toImageSrc } from '../../lib/media';
import { desktopHost as api } from '@renderer/runtime/desktop-host-services';
import { toast } from '../../stores/toast';
import type {
  DesignSchemeAssetSummary,
  DesignSchemeSummary,
} from '@musefold/desktop-contracts/design-scheme';
import type { DesignSchemeRevisionDocument } from '@musefold/desktop-contracts/design-scheme/schema';
import { useSchemeCreationStore } from './creation-store';
import { useSchemeRunStore } from './run-store';
import { SchemeActionMenu } from './SchemeActionMenu';
import { RuntimeAlbum } from './SchemeRuntimeAlbum';
import { SchemeRuntimeDocumentSections, type SchemeInputEdit } from './SchemeRuntimeDetailSections';
import { RenameDialog, RemoveDialog, SourceSnapshotDialog } from './SchemeRuntimeDialogs';
import { FIDELITY_LABEL } from './scheme-runtime-labels';

export function SchemeRuntimeDetail({
  scheme,
  onBack,
  onChanged,
  onRemoved,
}: {
  scheme: DesignSchemeSummary;
  onBack: () => void;
  onChanged: (updated: DesignSchemeSummary) => void;
  /** 删除草稿 / 移除方案成功后由父级刷新列表并返回。 */
  onRemoved: () => void;
}) {
  const attachSchemeRun = useSchemeRunStore((state) => state.attach);
  const attachSchemeModify = useSchemeCreationStore((state) => state.attachModify);
  const [document, setDocument] = useState<DesignSchemeRevisionDocument | null>(null);
  const [assets, setAssets] = useState<DesignSchemeAssetSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const [formalizeBusy, setFormalizeBusy] = useState(false);
  const [checkUpdateBusy, setCheckUpdateBusy] = useState(false);
  const [promoteBusy, setPromoteBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  /** 输入槽位编辑态（草稿限定）：staged 修改，保存时一次性生成新 revision。 */
  const [inputEdits, setInputEdits] = useState<SchemeInputEdit[] | null>(null);
  const [inputSaveBusy, setInputSaveBusy] = useState(false);
  /** §4.2 操作菜单打开的层：重命名 / 查看来源 / 删除（移除）确认。 */
  const [renameOpen, setRenameOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setDocument(null);
    setLoadError(null);
    setInputEdits(null);
    void (async () => {
      const [revision, assetList] = await Promise.all([
        api.designScheme.getRevision(scheme.currentRevisionId),
        api.designScheme.listAssets(scheme.id),
      ]);
      if (!alive) return;
      if (revision.ok) setDocument(revision.data);
      else setLoadError(revision.error.message);
      if (assetList.ok) setAssets(assetList.data);
    })();
    return () => { alive = false; };
  }, [scheme.id, scheme.currentRevisionId]);

  // 封面固定排在最前，其余按时间倒序（UI 规范 §5.2）。
  const orderedAssets = useMemo(() => assets.slice().sort((a, b) => {
    if (a.id === scheme.coverAssetId) return -1;
    if (b.id === scheme.coverAssetId) return 1;
    return b.createdAt - a.createdAt;
  }), [assets, scheme.coverAssetId]);

  const repoSource = document?.sources.find((source) => source.kind.startsWith('github') && source.uri);
  const canFormalize = scheme.status === 'draft' && scheme.hasSuccessfulTrial && Boolean(scheme.coverAssetId);

  // 被 promptProgram 模板引用的文本槽位不可删除（会留下无法填充的 {{变量}}）。
  const templateBoundIds = useMemo(() => {
    if (!document) return new Set<string>();
    const variables = new Set(document.promptProgram.flatMap((module) => module.variables));
    return new Set(
      document.inputs
        .filter((slot) => (slot.kind === 'text' || slot.kind === 'article' || slot.kind === 'choice') && variables.has(slot.id))
        .map((slot) => slot.id),
    );
  }, [document]);

  const inputEditsDirty = useMemo(() => {
    if (!inputEdits || !document) return false;
    return inputEdits.some((edit) => {
      const base = document.inputs.find((slot) => slot.id === edit.id);
      return edit.removed || (base && base.required !== edit.required);
    });
  }, [inputEdits, document]);

  const beginInputEdit = () => {
    if (!document) return;
    setInputEdits(document.inputs.map((slot) => ({ id: slot.id, required: slot.required, removed: false })));
  };

  const saveInputEdits = async () => {
    if (!document || !inputEdits || inputSaveBusy) return;
    setInputSaveBusy(true);
    const kept = inputEdits.filter((edit) => !edit.removed).map((edit) => ({ id: edit.id, required: edit.required }));
    const result = await api.designScheme.updateInputs(scheme.id, document.revisionId, kept);
    setInputSaveBusy(false);
    if (!result.ok) {
      toast.error('保存失败', result.error.message);
      return;
    }
    setDocument(result.data.document);
    setInputEdits(null);
    onChanged(result.data.summary);
    toast.success('输入要求已更新', '已生成新版本；需要重新试运行后才能设为正式。');
  };

  const runScheme = () => {
    void attachSchemeRun(scheme, scheme.status === 'formal' ? 'formal' : 'trial');
  };

  const selectCover = async (assetId: string) => {
    setCoverBusy(true);
    const result = await api.designScheme.selectCover(scheme.id, assetId);
    setCoverBusy(false);
    if (!result.ok) {
      toast.error('设为封面失败', result.error.message);
      return;
    }
    onChanged(result.data);
    toast.success('已更新封面');
  };

  const formalize = async () => {
    if (formalizeBusy) return;
    setFormalizeBusy(true);
    const result = await api.designScheme.formalize(scheme.id);
    setFormalizeBusy(false);
    if (!result.ok) {
      toast.error('还不能设为正式', result.error.message);
      return;
    }
    onChanged(result.data);
    toast.success('方案已设为正式', '现在可以在 Composer 中直接使用。');
  };

  const modifyInComposer = () => {
    void attachSchemeModify(scheme.id);
  };

  // 导出 .musefold.design 分享包（设计规范 §7）：仅正式方案可导出。
  const exportScheme = async () => {
    if (exportBusy) return;
    setExportBusy(true);
    const result = await api.designScheme.exportScheme(scheme.id);
    setExportBusy(false);
    if (!result.ok) {
      toast.error('导出失败', result.error.message);
      return;
    }
    if (result.data.cancelled) return;
    toast.success('分享包已导出', `${result.data.fileName ?? ''} · 可发给其他 Musefold 用户导入`);
  };

  // 「检查更新」（§4.2）：对比上游 commit；有变化时自动编译为待验证草稿。
  const checkUpdate = async () => {
    if (checkUpdateBusy) return;
    setCheckUpdateBusy(true);
    toast.show({ title: '正在检查上游更新…', description: '需要下载仓库快照，可能要几十秒。' });
    const result = await api.designScheme.checkUpdate(scheme.id);
    setCheckUpdateBusy(false);
    if (!result.ok) {
      toast.error('检查更新失败', result.error.message);
      return;
    }
    if (result.data.status === 'draft-created' && result.data.scheme) {
      onChanged(result.data.scheme);
      toast.success('发现上游更新', result.data.detail);
    } else {
      toast.show({ title: result.data.status === 'up-to-date' ? '已是最新' : '无法检查更新', description: result.data.detail });
    }
  };

  // 待验证新版本 → 替换正式版本（规范 §2.2）；主进程校验新版本已有成功试运行。
  const promoteWorkingDraft = async () => {
    if (promoteBusy) return;
    setPromoteBusy(true);
    const result = await api.designScheme.promoteWorkingDraft(scheme.id);
    setPromoteBusy(false);
    if (!result.ok) {
      toast.error('还不能更新正式版本', result.error.message);
      return;
    }
    onChanged(result.data);
    toast.success('正式版本已更新', '新版本现在是这个方案的正式版本。');
  };

  return (
    <div className="h-full overflow-y-auto" data-testid="runtime-scheme-detail" data-scheme-id={scheme.id} data-status={scheme.status}>
      <div className="mx-auto w-full max-w-[880px] px-6 pb-16 pt-5 max-[640px]:px-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-md pr-2 text-[11px] text-tertiary hover:bg-hover hover:text-primary"
          data-testid="runtime-scheme-detail-back"
        >
          <ArrowLeft className="h-3.5 w-3.5" />方案
        </button>

        <div className="mt-5 flex items-start gap-4">
          {scheme.coverImagePath ? (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border-subtle bg-inset/55">
              <img src={toImageSrc(scheme.coverImagePath)} alt="" className="h-full w-full object-cover" />
            </span>
          ) : (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary text-background" aria-hidden>
              <Blocks className="h-5 w-5" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[20px] font-semibold text-primary">{scheme.name}</h1>
              <span className="text-meta text-tertiary">{scheme.status === 'formal' ? '正式' : '草稿'}</span>
              <span className="rounded-full border border-border-subtle px-1.5 py-0.5 text-meta text-secondary">
                {FIDELITY_LABEL[scheme.fidelity] ?? scheme.fidelity}
              </span>
            </div>
            <p className="mt-1.5 max-w-[62ch] text-[12px] leading-5 text-secondary">{scheme.summary}</p>
            <p className="mt-2 flex items-center gap-1.5 truncate text-meta text-tertiary">
              {scheme.sourcePresentation === 'skill' ? <GitBranch className="h-3 w-3 shrink-0" /> : <Sparkles className="h-3 w-3 shrink-0" />}
              {scheme.sourcePresentation === 'skill' ? 'Skill' : 'Musefold 创建'} · {scheme.sourceLabel}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <SchemeActionMenu
              scheme={scheme}
              onModify={scheme.status === 'formal' ? modifyInComposer : null}
              onRename={() => setRenameOpen(true)}
              onViewSource={() => setSourceOpen(true)}
              onCheckUpdate={repoSource ? () => void checkUpdate() : null}
              checkUpdateBusy={checkUpdateBusy}
              onExport={scheme.status === 'formal' ? () => void exportScheme() : null}
              exportBusy={exportBusy}
              onRemove={() => setRemoveOpen(true)}
            />
            {scheme.status === 'draft' && (
              <button
                type="button"
                onClick={modifyInComposer}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border-default px-3 text-[11px] font-medium text-primary hover:bg-hover"
                data-testid="runtime-scheme-modify"
              >
                <Pencil className="h-3.5 w-3.5" />继续修改
              </button>
            )}
            {canFormalize && (
              <button
                type="button"
                onClick={() => void formalize()}
                disabled={formalizeBusy}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border-default px-3 text-[11px] font-medium text-primary hover:bg-hover disabled:cursor-wait disabled:opacity-50"
                data-testid="runtime-scheme-formalize"
              >
                设为正式
              </button>
            )}
            <button
              type="button"
              onClick={runScheme}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[11px] font-semibold text-background hover:opacity-85"
              data-testid="runtime-scheme-primary-action"
            >
              {scheme.status === 'formal' ? <Play className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {scheme.status === 'formal' ? '使用' : '试运行'}
            </button>
          </div>
        </div>

        {scheme.status === 'formal' && scheme.workingDraftRevisionId && (
          <div
            className="mt-6 flex flex-wrap items-center gap-3 rounded-md border border-accent/30 bg-accent-soft/60 px-4 py-3"
            data-testid="runtime-scheme-working-draft"
          >
            <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[11.5px] font-medium text-primary">这个方案有一个待验证的新版本</p>
              <p className="mt-0.5 text-meta text-tertiary">当前正式版本继续可用；新版本完成一次成功试运行后可以替换它。</p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => void attachSchemeRun(scheme, 'trial')}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border-default px-3 text-[11px] font-medium text-primary hover:bg-hover"
                data-testid="runtime-scheme-trial-working-draft"
              >
                <RefreshCw className="h-3.5 w-3.5" />试运行新版本
              </button>
              <button
                type="button"
                disabled={promoteBusy}
                onClick={() => void promoteWorkingDraft()}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[11px] font-semibold text-background hover:opacity-85 disabled:cursor-wait disabled:opacity-50"
                data-testid="runtime-scheme-promote-working-draft"
              >
                更新正式版本
              </button>
            </div>
          </div>
        )}

        <div className="mt-8">
          <RuntimeAlbum
            assets={orderedAssets}
            coverAssetId={scheme.coverAssetId}
            onSetCover={(assetId) => void selectCover(assetId)}
            coverBusy={coverBusy}
          />
        </div>

        {loadError && (
          <div className="mt-8 rounded-md border border-danger/25 bg-danger/5 px-3 py-2 text-meta text-danger">{loadError}</div>
        )}
        {!document && !loadError && (
          <div className="mt-10 py-8 text-center text-[11px] text-tertiary">正在读取方案内容…</div>
        )}

        <SchemeRuntimeDocumentSections
          scheme={scheme}
          document={document}
          inputEdits={inputEdits}
          setInputEdits={setInputEdits}
          inputSaveBusy={inputSaveBusy}
          inputEditsDirty={inputEditsDirty}
          templateBoundIds={templateBoundIds}
          beginInputEdit={beginInputEdit}
          saveInputEdits={saveInputEdits}
        />
      </div>
      {renameOpen && (
        <RenameDialog scheme={scheme} onClose={() => setRenameOpen(false)} onRenamed={onChanged} />
      )}
      {sourceOpen && (
        <SourceSnapshotDialog
          scheme={scheme}
          briefExcerpt={document?.compilation.briefExcerpt ?? null}
          onClose={() => setSourceOpen(false)}
        />
      )}
      {removeOpen && (
        <RemoveDialog scheme={scheme} onClose={() => setRemoveOpen(false)} onRemoved={onRemoved} />
      )}
    </div>
  );
}
