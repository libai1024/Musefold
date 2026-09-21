'use client';
import { useEffect, useRef, useState } from 'react';
import type { CreateDesignSchemeResult, DesignSchemeTextModelOffer } from '@musefold/contracts';
import { Button } from '@musefold/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@musefold/ui/components/dialog';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@musefold/ui/components/sheet';
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
import { useAccountStatus } from '../account/hooks';
import { isAccountRestricted } from '../account/account-session';
import { useMediaQuery } from '../history/hooks';
import {
  AGENT_BLOCKER_LABELS,
  AGENT_OPERATION_LABELS,
  AGENT_STATUS_LABELS,
  agentIsTerminal,
  agentIntentCallLimit,
} from './agent-presentation';
import { AgentExecutionHistory } from './AgentExecutionHistory';
import { useSchemeAgent } from './use-scheme-agent';

export function SchemeAgentDialog({
  intent,
  onClose,
  onRestoreFocus,
  onCompleted,
  onOpenScheme,
}: {
  intent?: import('./agent-presentation').SchemeAgentIntent;
  onClose(): void;
  onRestoreFocus(): void;
  onCompleted?(result: CreateDesignSchemeResult): void;
  onOpenScheme(id: string): void;
}) {
  const account = useAccountStatus();
  const allowed = !!account.data && !account.isError && !isAccountRestricted(account.data);
  const flow = useSchemeAgent(intent, allowed);
  const visible = allowed && !flow.changedAccount;
  const [confirmCancel, setConfirmCancel] = useState(false);
  const desktop = useMediaQuery('(min-width: 768px)');
  const notified = useRef(false);
  const session = flow.session;
  useEffect(() => {
    if (visible && session?.result && !notified.current) {
      notified.current = true;
      onCompleted?.(session.result);
    }
  }, [session, visible, onCompleted]);
  const Title = desktop ? DialogTitle : SheetTitle;
  const Description = desktop ? DialogDescription : SheetDescription;
  const pending = session?.pendingSource;
  const source = pending?.source;
  const body = (
    <>
      <div className="space-y-2 pr-8">
        <Title>
          {intent
            ? intent.operation === 'check-update'
              ? '检查来源更新'
              : intent.operation === 'modify'
                ? '修改云端方案'
                : '创建云端方案'
            : '方案任务'}
        </Title>
        <Description>
          核对来源、授权与原任务进度。关闭后可在方案中心的“方案任务”继续查看。
        </Description>
      </div>
      <div
        className="min-h-0 flex-1 space-y-4 overflow-y-auto text-sm"
        aria-busy={flow.busy || flow.reading}
      >
        {!visible ? (
          <p role="alert">
            {flow.changedAccount
              ? '账号已变化，请关闭后在当前账号下重新核对。'
              : account.isPending
                ? '正在核对账号…'
                : '请先登录并完成账号核对。'}
          </p>
        ) : (
          <>
            {!intent && !flow.id ? <AgentExecutionHistory onSelect={flow.select} /> : null}
            {intent?.operation === 'check-update' && !flow.id ? (
              <section className="space-y-3">
                <p>
                  检查当前选定版本的上游来源，已有正式版保持不变。检查和来源确认不会调用文本模型；编译更新需要另行同意费用。
                </p>
                <Button
                  className="min-h-11 md:min-h-8"
                  disabled={flow.busy}
                  onClick={() => void flow.start()}
                  data-testid="scheme-agent-check-update"
                >
                  开始免费检查
                </Button>
              </section>
            ) : null}
            {intent && intent.operation !== 'check-update' && !flow.id ? (
              <>
                <p className="whitespace-pre-wrap break-words" data-testid="scheme-agent-brief">
                  {intent.operation === 'modify'
                    ? intent.input.instruction
                    : intent.input.brief || '根据所选来源创建方案'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {intent.operation === 'modify'
                    ? '修改基于进入工作台时选定的版本。新版本需试运行验证，原正式版仍可使用。'
                    : `${intent.input.sourceUris.length} 个 GitHub 来源 · ${intent.input.historySources.length} 项历史素材`}
                </p>
                {flow.offer ? (
                  <TextOffer
                    offer={flow.offer}
                    calls={agentIntentCallLimit(intent)}
                    operation={intent.operation}
                    busy={flow.busy}
                    onAuthorize={() => void flow.start()}
                  />
                ) : (
                  <Button
                    variant="outline"
                    className="min-h-11 md:min-h-8"
                    disabled={flow.busy}
                    onClick={() => void flow.loadOffer()}
                    data-testid="scheme-agent-model-offer"
                  >
                    核对文本模型与费用
                  </Button>
                )}
              </>
            ) : null}
            {session ? (
              <section className="space-y-3" data-testid="scheme-agent-session">
                <p role="status" className="font-medium">
                  {AGENT_OPERATION_LABELS[session.operation]} ·{' '}
                  {AGENT_STATUS_LABELS[session.status]}
                </p>
                {session.operation === 'check-update' && session.update ? (
                  <div
                    className="space-y-2 text-xs text-muted-foreground"
                    data-testid="scheme-agent-update-changes"
                  >
                    <p>
                      已检查 {session.update.checkedSources} / {session.sourceCount} 个来源，发现{' '}
                      {session.update.changes.length} 项变化，已采用 {session.confirmedSources} 项。
                    </p>
                    {session.update.changes.map((change) => (
                      <p className="break-all" key={change.sourceExecutionId}>
                        提交 {change.previousCommit.slice(0, 10)} → {change.commit.slice(0, 10)}
                      </p>
                    ))}
                  </div>
                ) : session.sourceCount ? (
                  <p className="text-muted-foreground">
                    已确认 {session.confirmedSources} / {session.sourceCount} 个来源
                  </p>
                ) : null}
                {session.text ? (
                  <p className="text-xs text-muted-foreground">
                    {session.text.model} · 已登记 {session.text.callsSent} /{' '}
                    {session.text.maxModelCalls} 次调用，已完成 {session.text.callsCompleted} 次。
                    {session.text.cost === 'unknown'
                      ? '费用尚待核对，取消不保证免除已经发生的费用。'
                      : '尚未登记文本调用。'}
                  </p>
                ) : null}
                {session.blocker ? (
                  <p role="alert">{AGENT_BLOCKER_LABELS[session.blocker]}</p>
                ) : null}
                {session.status === 'authorization-required' ? (
                  <section className="space-y-3">
                    <p>变化来源已确认。编译新版本需要单独同意文本模型费用；已有正式版仍可使用。</p>
                    {!flow.updateAuthorized ? (
                      flow.offer ? (
                        <TextOffer
                          offer={flow.offer}
                          calls={(session.update?.changes.length ?? 0) + 1}
                          operation="check-update"
                          busy={flow.busy}
                          onAuthorize={() => void flow.authorizeUpdate()}
                        />
                      ) : (
                        <Button
                          variant="outline"
                          className="min-h-11 md:min-h-8"
                          disabled={flow.busy}
                          onClick={() => void flow.loadOffer()}
                          data-testid="scheme-agent-model-offer"
                        >
                          核对更新模型与费用
                        </Button>
                      )
                    ) : null}
                  </section>
                ) : null}
                {source && pending ? (
                  <section
                    className="space-y-2 border-y border-border py-4"
                    data-testid="scheme-agent-source"
                  >
                    <h3 className="font-medium">确认引入来源</h3>
                    <p className="break-words">{source.name}</p>
                    <p className="break-all text-xs text-muted-foreground">
                      {source.repositoryUrl}
                    </p>
                    <p className="break-words text-xs">
                      固定引用 {source.resolvedRef} ·{' '}
                      {source.commitHash?.slice(0, 10) ?? '提交信息待核对'}
                    </p>
                    <p>
                      {source.textFileCount} 个文本文件 · {source.imageFileCount} 张图片 · 许可证：
                      {source.license ?? '未声明'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      只读取规则、提示词与参考图片，不执行仓库脚本。
                      {session.operation === 'check-update'
                        ? '采用变化来源不会调用文本模型；全部确认后，编译仍需单独同意费用。'
                        : '引入后可在原文本授权范围内继续整理方案。'}
                    </p>
                    <Button
                      className="min-h-11 md:min-h-8"
                      disabled={flow.busy}
                      onClick={() => void flow.confirm(pending.confirmationId)}
                      data-testid="scheme-agent-confirm-source"
                    >
                      确认引入此来源
                    </Button>
                  </section>
                ) : null}
                {session.result ? (
                  <>
                    <p className="break-words">
                      {session.result.scheme.name}{' '}
                      {session.result.scheme.status === 'formal'
                        ? '已保存待验证新版本，原正式版未替换。'
                        : '已保存为待验证草稿。'}
                    </p>
                    <Button
                      className="min-h-11 md:min-h-8"
                      onClick={() => {
                        if (session.result) onOpenScheme(session.result.scheme.id);
                      }}
                      data-testid="scheme-agent-open-result"
                    >
                      查看草稿
                    </Button>
                  </>
                ) : null}
              </section>
            ) : null}
            {flow.busy || flow.reading ? (
              <p role="status">{flow.busy ? '正在核对操作…' : '正在读取原任务…'}</p>
            ) : null}
            {flow.error || flow.readError ? (
              <p role="alert" className="text-destructive">
                {flow.error ?? '暂时无法读取原任务。请刷新核对，不会自动重新发送。'}
              </p>
            ) : null}
            {flow.id && !flow.rejected ? (
              <Button
                variant="outline"
                className="min-h-11 md:min-h-8"
                disabled={flow.busy}
                onClick={() => void flow.refresh()}
                data-testid="scheme-agent-refresh"
              >
                刷新核对原任务
              </Button>
            ) : null}
            {flow.canReplayUpdate ? (
              <Button
                variant="outline"
                className="min-h-11 md:min-h-8"
                disabled={flow.busy}
                onClick={() => void flow.authorizeUpdate()}
                data-testid="scheme-agent-replay-update"
              >
                按原授权重试更新编译
              </Button>
            ) : null}
            {flow.canReplay ? (
              <Button
                variant="outline"
                className="min-h-11 md:min-h-8"
                disabled={flow.busy}
                onClick={() => void flow.start()}
                data-testid="scheme-agent-replay"
              >
                {intent?.operation === 'check-update'
                  ? '重试原免费检查请求'
                  : '按原授权重试同一请求'}
              </Button>
            ) : null}
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        关闭只结束本页等待，服务器任务受有效期限制。取消会影响其他页面，也不能撤回已发生的模型调用。
      </p>
      <div className="flex shrink-0 flex-wrap justify-end gap-2">
        {flow.id && visible && !flow.rejected && (!session || !agentIsTerminal(session)) ? (
          <Button
            variant="outline"
            className="min-h-11 md:min-h-8"
            disabled={flow.busy}
            onClick={() => setConfirmCancel(true)}
          >
            取消此任务
          </Button>
        ) : null}
        <Button variant="outline" className="min-h-11 md:min-h-8" onClick={onClose}>
          关闭
        </Button>
      </div>
      <AlertDialog open={confirmCancel && visible} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>取消这个方案任务？</AlertDialogTitle>
            <AlertDialogDescription>
              其他页面也会停止此任务，已发生的调用可能仍有费用。仅关闭进度窗口可保留任务继续处理。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>保留任务</AlertDialogCancel>
            <AlertDialogAction disabled={flow.busy || !visible} onClick={() => void flow.cancel()}>
              确认取消任务
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
  const restore = (event: Event) => {
    event.preventDefault();
    onRestoreFocus();
  };
  return desktop ? (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex max-h-[90dvh] flex-col"
        onCloseAutoFocus={restore}
        data-testid="scheme-agent-dialog"
      >
        {body}
      </DialogContent>
    </Dialog>
  ) : (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        className="flex max-h-[90dvh] flex-col px-4 pt-5 pb-[max(1rem,env(safe-area-inset-bottom))]"
        onCloseAutoFocus={restore}
        data-testid="scheme-agent-dialog"
      >
        {body}
      </SheetContent>
    </Sheet>
  );
}

function TextOffer({
  offer,
  calls,
  operation,
  busy,
  onAuthorize,
}: {
  offer: DesignSchemeTextModelOffer;
  calls: number;
  operation: 'create' | 'modify' | 'check-update';
  busy: boolean;
  onAuthorize(): void;
}) {
  return (
    <section
      className="space-y-2 border-y border-border py-4"
      data-testid="scheme-agent-authorization"
    >
      <h3 className="font-medium">确认文本模型费用</h3>
      <p className="break-words">模型：{offer.binding.model}</p>
      <p>
        本次最多 {calls} 次模型调用，每次最多输出 {offer.maxOutputTokens} Token。
      </p>
      <p>费用暂无法预估，可能消耗账号额度。来源引入与文本费用分别确认；试跑生图需另行发起。</p>
      <Button
        className="min-h-11 md:min-h-8"
        disabled={busy}
        onClick={onAuthorize}
        data-testid={`scheme-agent-authorize-${operation}`}
      >
        {operation === 'create'
          ? '同意费用未知并创建'
          : operation === 'modify'
            ? '同意费用未知并修改'
            : '同意费用未知并编译更新'}
      </Button>
    </section>
  );
}
