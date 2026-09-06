'use client';

import type { AiProvider, AiProviderModel, AiProviderTestResult } from '@musefold/contracts';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@musefold/ui/components/alert-dialog';
import { Badge } from '@musefold/ui/components/badge';
import { Button } from '@musefold/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@musefold/ui/components/card';
import { Combobox } from '@musefold/ui/components/combobox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@musefold/ui/components/dialog';
import { Input } from '@musefold/ui/components/input';
import { Label } from '@musefold/ui/components/label';
import { Skeleton } from '@musefold/ui/components/skeleton';
import { Spinner } from '@musefold/ui/components/spinner';
import { toast } from '@musefold/ui/components/sonner';
import { cn } from '@musefold/ui/lib/utils';
import { Pencil, Plug, Plus, Trash2 } from '@musefold/ui/icons';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useDiscardGuard } from '../shell/use-discard-guard';
import type { ConnectionPreset } from './connection-presets';
import {
  connectionStatusClass,
  connectionStatusKind,
  connectionStatusLabel,
} from './connection-status';
import type { ConnectionsHooks } from './hooks';

/**
 * 面板文案与 testid 前缀:两个本地连接面(生图 Provider / Agent 文本模型)共用同一 UI,
 * 只在这里分叉。testid 前缀保持各自历史值,E2E 与单测不受泛化影响。
 */
export interface ConnectionsPanelCopy {
  /** 卡片 testid(如 settings-ai-connections-card)。 */
  cardTestId: string;
  /** 行/编辑器/按钮 testid 前缀(如 ai-provider → ai-provider-edit)。 */
  itemTestIdPrefix: string;
  /** 列表 / 空态 testid(如 ai-providers-list / ai-providers-empty)。 */
  listTestId: string;
  emptyTestId: string;
  title: string;
  description: string;
  emptyText: string;
  editorTitleNew: string;
  editorTitleEdit: string;
  modelPlaceholder: string;
  deleteDescription: string;
  presets: readonly ConnectionPreset[];
}

interface EditorState {
  /** null = 新建;否则为被编辑的连接。 */
  target: AiProvider | null;
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}

function emptyEditor(): EditorState {
  return { target: null, name: '', baseUrl: '', model: '', apiKey: '' };
}

function editorFor(provider: AiProvider): EditorState {
  return {
    target: provider,
    name: provider.name,
    baseUrl: provider.baseUrl,
    model: provider.model,
    apiKey: '',
  };
}

function editorDirty(current: EditorState, initial: EditorState): boolean {
  return (
    current.name !== initial.name ||
    current.baseUrl !== initial.baseUrl ||
    current.model !== initial.model ||
    current.apiKey !== initial.apiKey
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败,请重试';
}

const KEY_REQUIRED_HINT = '先填写 API Key,再拉取模型或测试连接';

function PresetChips({
  presets,
  prefix,
  onSelect,
}: {
  presets: readonly ConnectionPreset[];
  prefix: string;
  onSelect: (preset: ConnectionPreset) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" data-testid={`${prefix}-presets`}>
      {presets.map((preset) => (
        <Button
          key={preset.id}
          type="button"
          variant={preset.recommended ? 'secondary' : 'outline'}
          size="sm"
          title={preset.hint}
          onClick={() => onSelect(preset)}
          data-testid={`${prefix}-preset-${preset.id}`}
        >
          {preset.name}
        </Button>
      ))}
    </div>
  );
}

function TestResultLine({
  result,
  testId,
}: {
  result: AiProviderTestResult | null;
  testId: string;
}) {
  return (
    <p
      role="status"
      className={cn(
        'min-h-4 text-xs',
        result?.ok ? 'text-success' : result ? 'text-destructive' : 'text-transparent',
      )}
      data-testid={testId}
    >
      {result?.ok ? (
        <>
          连接正常
          {result.latencyMs != null ? (
            <>
              {' · '}
              <span className="tabular-nums">{result.latencyMs}ms</span>
            </>
          ) : null}
        </>
      ) : (
        (result?.message ?? ' ')
      )}
    </p>
  );
}

function StatusDot({
  provider,
  lastTest,
  prefix,
}: {
  provider: AiProvider;
  lastTest: AiProviderTestResult | undefined;
  prefix: string;
}) {
  const kind = connectionStatusKind(provider.hasKey, lastTest);
  return (
    <span
      className={cn('inline-block size-1.5 shrink-0 rounded-full', connectionStatusClass(kind))}
      aria-label={connectionStatusLabel(kind)}
      data-testid={`${prefix}-status`}
    />
  );
}

function ProviderEditorDialog({
  editor,
  hooks,
  copy,
  onClose,
}: {
  editor: EditorState;
  hooks: ConnectionsHooks;
  copy: ConnectionsPanelCopy;
  onClose: () => void;
}) {
  const [form, setForm] = useState(editor);
  const [initial] = useState(editor);
  const [models, setModels] = useState<AiProviderModel[]>([]);
  const [modelsMessage, setModelsMessage] = useState<string | null>(null);
  const [keyPrompt, setKeyPrompt] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<AiProviderTestResult | null>(null);
  const [highlightModel, setHighlightModel] = useState(false);
  const keyRef = useRef<HTMLInputElement>(null);
  const create = hooks.useCreate();
  const update = hooks.useUpdate();
  const test = hooks.useTest();
  const listModels = hooks.useListModels();
  const pending = create.isPending || update.isPending;
  const isEdit = form.target !== null;
  const valid = form.name.trim() && form.baseUrl.trim() && form.model.trim();
  const dirty = editorDirty(form, initial);
  const discard = useDiscardGuard(dirty);
  const p = copy.itemTestIdPrefix;

  useEffect(() => {
    if (!highlightModel) return;
    const timer = window.setTimeout(() => setHighlightModel(false), 300);
    return () => window.clearTimeout(timer);
  }, [highlightModel]);

  const hasUsableKey = form.apiKey.trim().length > 0 || form.target?.hasKey === true;

  function requireKey(): boolean {
    if (hasUsableKey) {
      setKeyPrompt(null);
      return true;
    }
    setKeyPrompt(KEY_REQUIRED_HINT);
    keyRef.current?.focus();
    return false;
  }

  function applyPreset(preset: ConnectionPreset) {
    setForm((current) => ({ ...current, name: preset.name, baseUrl: preset.baseUrl }));
    setModels([]);
    setModelsMessage(null);
  }

  function probeInput() {
    if (form.apiKey.trim()) {
      return { baseUrl: form.baseUrl.trim(), apiKey: form.apiKey.trim() };
    }
    if (form.target) return { id: form.target.id };
    return null;
  }

  function handleListModels() {
    if (!form.baseUrl.trim() || !requireKey()) return;
    const input = probeInput();
    if (!input) return;
    setModelsMessage(null);
    listModels.mutate(input, {
      onSuccess: (result) => {
        setModels(result.models);
        if (result.models.length === 0) {
          setModelsMessage('未获取到模型,请检查网关');
          return;
        }
        if (result.models.length === 1) {
          const only = result.models[0];
          if (only) {
            setForm((current) => ({ ...current, model: only.id }));
            setHighlightModel(true);
            setModelsMessage('已替你选好');
          }
        }
      },
      onError: (error) => {
        setModelsMessage(`模型列表获取失败:${errorMessage(error)}`);
      },
    });
  }

  function handleTestConnection() {
    if (!form.baseUrl.trim() || !requireKey()) return;
    const input = probeInput();
    if (!input) return;
    setTestResult(null);
    test.mutate(
      'apiKey' in input
        ? { ...input, ...(form.model.trim() ? { model: form.model.trim() } : {}) }
        : input,
      {
        onSuccess: setTestResult,
        onError: (error) =>
          setTestResult({ ok: false, message: errorMessage(error), latencyMs: null }),
      },
    );
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid || pending) return;
    const onError = (error: unknown) => toast.error(errorMessage(error));
    if (form.target) {
      update.mutate(
        {
          id: form.target.id,
          patch: {
            name: form.name.trim(),
            baseUrl: form.baseUrl.trim(),
            model: form.model.trim(),
            ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
          },
        },
        { onSuccess: onClose, onError },
      );
    } else {
      create.mutate(
        {
          name: form.name.trim(),
          baseUrl: form.baseUrl.trim(),
          model: form.model.trim(),
          ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
          activate: false,
        },
        { onSuccess: onClose, onError },
      );
    }
  };

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) discard.requestClose(onClose);
        }}
      >
        <DialogContent
          className="sm:max-w-md"
          data-testid={`${p}-editor`}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            discard.requestClose(onClose);
          }}
          onPointerDownOutside={(event) => {
            event.preventDefault();
            discard.requestClose(onClose);
          }}
        >
          <DialogHeader>
            <DialogTitle>{isEdit ? copy.editorTitleEdit : copy.editorTitleNew}</DialogTitle>
          </DialogHeader>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <PresetChips presets={copy.presets} prefix={`${p}-editor`} onSelect={applyPreset} />
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${p}-name`}>名称</Label>
              <Input
                id={`${p}-name`}
                data-testid={`${p}-name`}
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="如:自建网关"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${p}-base-url`}>Base URL</Label>
              <Input
                id={`${p}-base-url`}
                data-testid={`${p}-base-url`}
                className="font-mono"
                value={form.baseUrl}
                onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
                placeholder="https://example.com/v1"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${p}-model`}>模型 ID</Label>
              <Combobox
                id={`${p}-model`}
                data-testid={`${p}-model`}
                value={form.model}
                onValueChange={(model) => setForm({ ...form, model })}
                options={models.map((model) => ({
                  value: model.id,
                  label: model.label,
                }))}
                placeholder={copy.modelPlaceholder}
                highlight={highlightModel}
              />
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={listModels.isPending}
                  onClick={handleListModels}
                  data-testid={`${p}-list-models`}
                >
                  {listModels.isPending && <Spinner className="size-3.5" />}
                  拉取模型列表
                </Button>
              </div>
              <p
                className={cn(
                  'min-h-4 text-xs',
                  !modelsMessage
                    ? 'text-transparent'
                    : modelsMessage.startsWith('模型列表获取失败') ||
                        modelsMessage.startsWith('未获取到模型')
                      ? 'text-destructive'
                      : 'text-muted-foreground',
                )}
                data-testid={`${p}-list-models-error`}
              >
                {modelsMessage ?? ' '}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${p}-key`}>API Key</Label>
              <Input
                ref={keyRef}
                id={`${p}-key`}
                data-testid={`${p}-key`}
                type="password"
                autoComplete="off"
                value={form.apiKey}
                onChange={(event) => {
                  setForm({ ...form, apiKey: event.target.value });
                  if (event.target.value.trim()) setKeyPrompt(null);
                }}
                placeholder={isEdit ? '留空保持不变' : '仅保存在系统安全存储'}
              />
              <p
                className={cn(
                  'min-h-4 text-xs',
                  keyPrompt ? 'text-destructive' : 'text-transparent',
                )}
                data-testid={`${p}-key-hint`}
              >
                {keyPrompt ?? ' '}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                disabled={test.isPending}
                onClick={handleTestConnection}
                data-testid={`${p}-editor-test`}
              >
                {test.isPending ? <Spinner className="size-3.5" /> : <Plug className="size-3.5" />}
                测试连接
              </Button>
              <TestResultLine result={testResult} testId={`${p}-editor-test-result`} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => discard.requestClose(onClose)}>
                取消
              </Button>
              <Button type="submit" disabled={!valid || pending} data-testid={`${p}-save`}>
                {pending && <Spinner className="size-3.5" />}
                保存
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={discard.confirmOpen} onOpenChange={discard.setConfirmOpen}>
        <AlertDialogContent className="max-w-sm" data-testid={`${p}-discard-dialog`}>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃修改?</AlertDialogTitle>
            <AlertDialogDescription>当前编辑内容尚未保存,关闭后修改将丢失。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid={`${p}-discard-continue`}>继续编辑</AlertDialogCancel>
            <AlertDialogAction
              data-testid={`${p}-discard`}
              variant="destructive"
              onClick={() => discard.confirmDiscard(onClose)}
            >
              放弃
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ProviderRow({
  provider,
  hooks,
  prefix: p,
  lastTest,
  onEdit,
  onDelete,
  onTested,
}: {
  provider: AiProvider;
  hooks: ConnectionsHooks;
  prefix: string;
  lastTest: AiProviderTestResult | undefined;
  onEdit: () => void;
  onDelete: () => void;
  onTested: (result: AiProviderTestResult) => void;
}) {
  const setActive = hooks.useSetActive();
  const test = hooks.useTest();

  return (
    <li
      className="flex flex-col gap-1 rounded-md border border-border px-3 py-2.5"
      data-testid={`${p}-${provider.id}`}
    >
      <div className="flex items-center gap-3">
        <StatusDot provider={provider} lastTest={lastTest} prefix={p} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-medium text-foreground text-sm">{provider.name}</p>
            {provider.isActive && (
              <Badge variant="secondary" data-testid={`${p}-active-badge`}>
                默认
              </Badge>
            )}
            {provider.managedBy === 'account' && (
              <Badge variant="outline" data-testid={`${p}-managed-badge`}>
                账号托管
              </Badge>
            )}
          </div>
          <p className="mt-0.5 truncate font-mono text-muted-foreground text-xs">
            {provider.model} · {provider.baseUrl}
            {provider.hasKey ? ` · 密钥 …${provider.keySuffix ?? ''}` : ' · 未配置密钥'}
          </p>
        </div>
        {!provider.isActive && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground text-xs"
            onClick={() => setActive.mutate(provider.id)}
            disabled={setActive.isPending}
            data-testid={`${p}-set-active`}
          >
            设为默认
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          aria-label="测试连接"
          disabled={test.isPending}
          onClick={() => {
            test.mutate(
              { id: provider.id },
              {
                onSuccess: onTested,
                onError: (error) =>
                  onTested({ ok: false, message: errorMessage(error), latencyMs: null }),
              },
            );
          }}
          data-testid={`${p}-test`}
        >
          {test.isPending ? <Spinner className="size-3.5" /> : <Plug className="size-3.5" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          aria-label="编辑连接"
          onClick={onEdit}
          disabled={provider.managedBy === 'account'}
          data-testid={`${p}-edit`}
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-destructive"
          aria-label="删除连接"
          onClick={onDelete}
          disabled={provider.managedBy === 'account'}
          data-testid={`${p}-delete`}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      <TestResultLine result={lastTest ?? null} testId={`${p}-test-result`} />
    </li>
  );
}

/**
 * 本地连接管理面板(桌面专属,V25-UI-SPEC §7.2):列表 + 新建/编辑 Dialog + 默认切换 + 测试 + 删除。
 * 密钥 write-only:表单提交后只有 hasKey/keySuffix 状态回来,永不回显。
 * 生图 Provider 与 Agent 文本连接用不同的 hooks 集与文案实例化本组件。
 */
export function ConnectionsPanel({
  hooks,
  copy,
}: {
  hooks: ConnectionsHooks;
  copy: ConnectionsPanelCopy;
}) {
  const providers = hooks.useList();
  const remove = hooks.useRemove();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleting, setDeleting] = useState<AiProvider | null>(null);
  const [testById, setTestById] = useState<Record<string, AiProviderTestResult>>({});
  const p = copy.itemTestIdPrefix;

  function openNew(preset?: ConnectionPreset) {
    const next = emptyEditor();
    if (preset) {
      next.name = preset.name;
      next.baseUrl = preset.baseUrl;
    }
    setEditor(next);
  }

  return (
    <Card data-testid={copy.cardTestId}>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="flex flex-col gap-1.5">
          <CardTitle>{copy.title}</CardTitle>
          <CardDescription>{copy.description}</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => openNew()} data-testid={`${p}-new`}>
          <Plus className="size-4" />
          新建
        </Button>
      </CardHeader>
      <CardContent>
        {providers.isPending ? (
          <Skeleton className="h-12 w-full" />
        ) : providers.isError ? (
          <div className="flex flex-col gap-2">
            <p className="text-destructive text-sm">连接列表读取失败,请重试</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => void providers.refetch()}
              data-testid={`${p}-list-retry`}
            >
              重试
            </Button>
          </div>
        ) : providers.data.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-muted-foreground text-sm" data-testid={copy.emptyTestId}>
              {copy.emptyText}
            </p>
            <PresetChips presets={copy.presets} prefix={p} onSelect={openNew} />
          </div>
        ) : (
          <ul className="flex flex-col gap-2" data-testid={copy.listTestId}>
            {providers.data.map((provider) => (
              <ProviderRow
                key={provider.id}
                provider={provider}
                hooks={hooks}
                prefix={p}
                lastTest={testById[provider.id]}
                onEdit={() => setEditor(editorFor(provider))}
                onDelete={() => setDeleting(provider)}
                onTested={(result) =>
                  setTestById((current) => ({ ...current, [provider.id]: result }))
                }
              />
            ))}
          </ul>
        )}
      </CardContent>

      {editor && (
        <ProviderEditorDialog
          key={editor.target?.id ?? 'new'}
          editor={editor}
          hooks={hooks}
          copy={copy}
          onClose={() => setEditor(null)}
        />
      )}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除连接「{deleting?.name}」?</AlertDialogTitle>
            <AlertDialogDescription>{copy.deleteDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!deleting) return;
                remove.mutate(deleting.id, {
                  onError: (error) => toast.error(errorMessage(error)),
                });
                setDeleting(null);
              }}
              data-testid={`${p}-delete-confirm`}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
