'use client';

import type { LocalWorkspaceRecoveryStatus, PrepareLocalWorkspaceInput } from '@musefold/contracts';
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
import { Button } from '@musefold/ui/components/button';
import { Spinner } from '@musefold/ui/components/spinner';
import { useState } from 'react';
import { useLocalWorkspacePreview, usePrepareLocalWorkspace } from './workspace-recovery-hooks';

export function LocalWorkspaceRecovery({
  data,
  refresh,
}: {
  data: LocalWorkspaceRecoveryStatus;
  refresh(): void;
}) {
  return (
    <RecoveryContent
      key={data.reviewRef ?? 'read-only'}
      data={data}
      refresh={refresh}
      accountName={data.targetAccount?.username ?? '当前账号'}
    />
  );
}

function RecoveryContent({
  data,
  refresh,
  accountName,
}: {
  data: LocalWorkspaceRecoveryStatus;
  refresh(): void;
  accountName: string;
}) {
  const [sourceId, setSourceId] = useState('');
  const [cursor, setCursor] = useState<string>();
  const [confirmation, setConfirmation] = useState<PrepareLocalWorkspaceInput | null>(null);
  const [completed, setCompleted] = useState(false);
  const preview = useLocalWorkspacePreview(sourceId, cursor);
  const prepare = usePrepareLocalWorkspace();
  const canPrepare = data.canPrepare && !!data.reviewRef && !!data.targetAccount;
  const selected = data.sources.find((source) => source.sourceId === sourceId);
  const error = prepare.error ?? preview.error;
  const select = (next: string) => {
    setSourceId(next);
    setCursor(undefined);
    prepare.reset();
  };

  return (
    <section
      className="flex min-w-0 flex-col gap-3 rounded-lg border p-4"
      aria-label="本机提示词库恢复"
    >
      <div className="space-y-1">
        <h3 className="font-medium text-sm">本机保存的提示词库</h3>
        <p className="text-muted-foreground text-sm">
          可以查看本机旧数据，再选择复制到已验证的当前账号。列表中的名称只是本机记录，不代表账号归属。
        </p>
        <p className="text-muted-foreground text-xs">
          复制提示词、文件夹、标签和使用次数；旧库完整保留。生成历史、图片文件、设计方案与旧同步记录不在此复制范围。
        </p>
      </div>
      {data.targetReady ? (
        <p className="text-muted-foreground text-sm">
          当前账号已有提示词库。仍可查看旧库，不能覆盖或合并。
        </p>
      ) : !canPrepare ? (
        <p className="text-muted-foreground text-sm">
          先在账号面板完成登录或归属验证，再选择复制或建立空库；现在仍可查看本机旧数据。
        </p>
      ) : (
        <p className="text-sm">
          为 {accountName} 选择初始提示词库。此步骤只在本机保存，下一步再决定是否开启云同步。
        </p>
      )}
      {data.sources.map((source) => (
        <div
          key={source.sourceId}
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
        >
          <div className="min-w-0 text-sm">
            <p className="break-words">{source.label}</p>
            <p className="text-muted-foreground text-xs">
              {source.counts.prompts} 条提示词 · {source.counts.folders} 个文件夹 ·{' '}
              {source.counts.tags} 个标签 · {new Date(source.createdAt).toLocaleDateString('zh-CN')}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={prepare.isPending}
            onClick={() => select(source.sourceId)}
            aria-label={`查看 ${source.label}`}
          >
            查看内容
          </Button>
        </div>
      ))}
      {data.sources.length === 0 && (
        <p className="text-muted-foreground text-sm">未发现其他本机提示词库。</p>
      )}
      {selected && (
        <div className="space-y-3 border-t pt-3" aria-label={`${selected.label} 内容预览`}>
          <h4 className="font-medium text-sm">{selected.label}</h4>
          {preview.isPending || preview.isFetching ? (
            <p className="flex items-center gap-2 text-sm" role="status">
              <Spinner className="size-4" />
              正在读取本机数据
            </p>
          ) : (
            preview.data && (
              <>
                <p className="break-words text-muted-foreground text-xs">
                  文件夹：{preview.data.folders.map((folder) => folder.name).join('、') || '无'}
                  <br />
                  标签：{preview.data.tags.map((tag) => tag.name).join('、') || '无'}
                </p>
                {(selected.counts.folders > preview.data.folders.length ||
                  selected.counts.tags > preview.data.tags.length) && (
                  <p className="text-muted-foreground text-xs">
                    摘要各显示前 200 个文件夹和标签；每条提示词仍显示其所属分类，复制包含整份库。
                  </p>
                )}
                {preview.data.prompts.length === 0 && (
                  <p className="text-muted-foreground text-sm">此页没有提示词。</p>
                )}
                {preview.data.prompts.map((prompt) => (
                  <article key={prompt.id} className="space-y-1 rounded-md bg-muted p-3 text-sm">
                    <h5 className="break-words font-medium">
                      {prompt.title}
                      {prompt.isDeleted ? '（已删除，复制后仍保留删除状态）' : ''}
                    </h5>
                    <p className="whitespace-pre-wrap break-words">{prompt.content}</p>
                    {prompt.negative && (
                      <p className="whitespace-pre-wrap break-words text-muted-foreground">
                        负面提示词：{prompt.negative}
                      </p>
                    )}
                    <p className="text-muted-foreground text-xs">
                      {prompt.folderName ?? '未分类'}
                      {prompt.tags.length > 0 ? ` · ${prompt.tags.join('、')}` : ''}
                    </p>
                  </article>
                ))}
                <div className="flex flex-wrap gap-2">
                  {cursor && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setCursor(String(Math.max(0, Number(cursor) - 20)))}
                    >
                      上一页
                    </Button>
                  )}
                  {preview.data.nextCursor && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setCursor(preview.data.nextCursor ?? undefined)}
                    >
                      下一页
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => void preview.refetch()}>
                    重新读取
                  </Button>
                  {canPrepare && (
                    <Button
                      size="sm"
                      disabled={prepare.isPending}
                      onClick={() =>
                        setConfirmation({
                          mode: 'copy',
                          reviewRef: data.reviewRef ?? '',
                          sourceId,
                          expectedRevision: preview.data.revision,
                        })
                      }
                    >
                      复制这份库到当前账号
                    </Button>
                  )}
                </div>
              </>
            )
          )}
        </div>
      )}
      {error && (
        <div role="alert" className="space-y-2 text-destructive text-sm">
          <p>{error instanceof Error ? error.message : '本机数据操作失败，请重试'}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              prepare.reset();
              refresh();
              if (sourceId) void preview.refetch();
            }}
          >
            刷新并重新查看
          </Button>
        </div>
      )}
      {completed && (
        <p role="status" className="text-sm">
          当前账号的本机提示词库已准备好。云同步尚未开启，请在下方确认开启。
        </p>
      )}
      {canPrepare && (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          disabled={prepare.isPending}
          onClick={() => setConfirmation({ mode: 'empty', reviewRef: data.reviewRef ?? '' })}
        >
          建立空的提示词库
        </Button>
      )}
      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open && !prepare.isPending) setConfirmation(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmation?.mode === 'copy' ? '确认复制本机提示词库' : '确认建立空的提示词库'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmation?.mode === 'copy'
                ? `将查看的 ${selected?.label ?? '本机提示词库'} 完整复制给 ${accountName}，不会删除原库，也不会复制旧账号同步记录。`
                : `为 ${accountName} 建立空的本机提示词库，旧库仍可查看。之后不能把旧库覆盖或合并进这个库。`}{' '}
              此操作不会开启云同步。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={prepare.isPending}>返回查看</AlertDialogCancel>
            <AlertDialogAction
              disabled={prepare.isPending || !canPrepare}
              onClick={(event) => {
                event.preventDefault();
                if (confirmation)
                  prepare.mutate(confirmation, {
                    onSuccess: () => {
                      setConfirmation(null);
                      setCompleted(true);
                    },
                    onError: () => setConfirmation(null),
                  });
              }}
            >
              {prepare.isPending && <Spinner className="size-4" />}确认并在本机保存
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
