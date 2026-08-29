'use client';

import type { AiProvider, AiProviderTestResult } from '@musefold/contracts';
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
import { type FormEvent, useState } from 'react';
import {
  useAiProviders,
  useCreateAiProvider,
  useRemoveAiProvider,
  useSetActiveAiProvider,
  useTestAiProvider,
  useUpdateAiProvider,
} from './hooks';

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败,请重试';
}

function ProviderEditorDialog({ editor, onClose }: { editor: EditorState; onClose: () => void }) {
  const [form, setForm] = useState(editor);
  const create = useCreateAiProvider();
  const update = useUpdateAiProvider();
  const pending = create.isPending || update.isPending;
  const isEdit = form.target !== null;
  const valid = form.name.trim() && form.baseUrl.trim() && form.model.trim();

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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="ai-provider-editor">
        <DialogHeader>
          <DialogTitle>{isEdit ? '编辑 AI 连接' : '新建 AI 连接'}</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ai-provider-name">名称</Label>
            <Input
              id="ai-provider-name"
              data-testid="ai-provider-name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="如:自建网关"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ai-provider-base-url">Base URL</Label>
            <Input
              id="ai-provider-base-url"
              data-testid="ai-provider-base-url"
              value={form.baseUrl}
              onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
              placeholder="https://example.com/v1"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ai-provider-model">模型 ID</Label>
            <Input
              id="ai-provider-model"
              data-testid="ai-provider-model"
              value={form.model}
              onChange={(event) => setForm({ ...form, model: event.target.value })}
              placeholder="如:gemini-2.5-flash-image"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ai-provider-key">API Key</Label>
            <Input
              id="ai-provider-key"
              data-testid="ai-provider-key"
              type="password"
              autoComplete="off"
              value={form.apiKey}
              onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
              placeholder={isEdit ? '留空保持不变' : '仅保存在系统安全存储'}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={!valid || pending} data-testid="ai-provider-save">
              {pending && <Spinner className="size-3.5" />}
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProviderRow({
  provider,
  onEdit,
  onDelete,
}: {
  provider: AiProvider;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const setActive = useSetActiveAiProvider();
  const test = useTestAiProvider();
  const [testResult, setTestResult] = useState<AiProviderTestResult | null>(null);

  return (
    <li
      className="flex flex-col gap-1 rounded-md border border-border px-3 py-2.5"
      data-testid={`ai-provider-${provider.id}`}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-medium text-foreground text-sm">{provider.name}</p>
            {provider.isActive && (
              <Badge variant="secondary" data-testid="ai-provider-active-badge">
                默认
              </Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-muted-foreground text-xs">
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
            data-testid="ai-provider-set-active"
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
            setTestResult(null);
            test.mutate(provider.id, {
              onSuccess: setTestResult,
              onError: (error) =>
                setTestResult({ ok: false, message: errorMessage(error), latencyMs: null }),
            });
          }}
          data-testid="ai-provider-test"
        >
          {test.isPending ? <Spinner className="size-3.5" /> : <Plug className="size-3.5" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          aria-label="编辑连接"
          onClick={onEdit}
          data-testid="ai-provider-edit"
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-destructive"
          aria-label="删除连接"
          onClick={onDelete}
          data-testid="ai-provider-delete"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      {testResult && (
        <p
          className={cn('text-xs', testResult.ok ? 'text-emerald-600' : 'text-destructive')}
          data-testid="ai-provider-test-result"
        >
          {testResult.ok
            ? `连接正常${testResult.latencyMs != null ? ` · ${testResult.latencyMs}ms` : ''}`
            : testResult.message}
        </p>
      )}
    </li>
  );
}

/**
 * AI 连接管理(桌面专属,V25-UI-SPEC §7.2):本地生图 Provider 的增删改与默认切换。
 * 密钥 write-only:表单提交后只有 hasKey/keySuffix 状态回来,永不回显。
 */
export function AiConnectionsPanel() {
  const providers = useAiProviders();
  const remove = useRemoveAiProvider();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleting, setDeleting] = useState<AiProvider | null>(null);

  return (
    <Card data-testid="settings-ai-connections-card">
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="flex flex-col gap-1.5">
          <CardTitle>AI 连接</CardTitle>
          <CardDescription>本地生图服务连接,密钥保存在系统安全存储</CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setEditor(emptyEditor())}
          data-testid="ai-provider-new"
        >
          <Plus className="size-4" />
          新建
        </Button>
      </CardHeader>
      <CardContent>
        {providers.isPending ? (
          <Skeleton className="h-12 w-full" />
        ) : providers.isError ? (
          <p className="text-destructive text-sm">连接列表读取失败,请重试</p>
        ) : providers.data.length === 0 ? (
          <p className="text-muted-foreground text-sm" data-testid="ai-providers-empty">
            尚未配置 AI 连接。新建一个以启用本地生图。
          </p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="ai-providers-list">
            {providers.data.map((provider) => (
              <ProviderRow
                key={provider.id}
                provider={provider}
                onEdit={() => setEditor(editorFor(provider))}
                onDelete={() => setDeleting(provider)}
              />
            ))}
          </ul>
        )}
      </CardContent>

      {editor && (
        <ProviderEditorDialog
          key={editor.target?.id ?? 'new'}
          editor={editor}
          onClose={() => setEditor(null)}
        />
      )}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除连接「{deleting?.name}」?</AlertDialogTitle>
            <AlertDialogDescription>
              连接配置与其密钥将一并删除,不可恢复;已生成的图片不受影响。
            </AlertDialogDescription>
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
              data-testid="ai-provider-delete-confirm"
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
