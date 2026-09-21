'use client';

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
import { MusefoldMark } from '@musefold/ui/components/brand-mark';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@musefold/ui/components/dialog';
import { LockKeyhole } from '@musefold/ui/icons';
import { useState } from 'react';
import { useActiveSession } from '../workbench/session-store';
import { OnboardingStepConnect } from './OnboardingStepConnect';
import { OnboardingStepFirstImage } from './OnboardingStepFirstImage';
import { OnboardingStepValidate } from './OnboardingStepValidate';
import { OnboardingStepWelcome } from './OnboardingStepWelcome';
import { useCompleteOnboarding, useOnboardingFlow, useOnboardingGate } from './onboarding-store';
import { OnboardingProgress } from './onboarding-ui';

/** 引导可以要求宿主切到哪些屏(宿主用自己已有的导航机制落地)。 */
export type OnboardingScreenId = 'workbench' | 'settings';

export interface OnboardingFlowProps {
  /** 切屏回调(宿主注入):首图送稿与完成引导都落到工作台。 */
  onOpenScreen?: (screen: OnboardingScreenId) => void;
}

/**
 * 首次启动引导(U01-onboarding,V25-UI-SPEC §2/§7)。
 *
 * 形态:桌面 md+ 居中 640px 卡,移动全屏;`role=dialog aria-modal` 与焦点圈闭由 Radix 承担。
 * 关闭(Esc / 点遮罩)= 跳过,先经 AlertDialog 确认;跳过与完成写同一个完成哨兵。
 * 四端同一份:BYOK 与豆包两轨由 capability 门控,Web 只显示官方账号轨。
 */
export function OnboardingFlow({ onOpenScreen }: OnboardingFlowProps) {
  const gate = useOnboardingGate();
  const step = useOnboardingFlow((state) => state.step);
  const track = useOnboardingFlow((state) => state.track);
  const providerId = useOnboardingFlow((state) => state.providerId);
  const draftPrompt = useOnboardingFlow((state) => state.draftPrompt);
  const selectTrack = useOnboardingFlow((state) => state.selectTrack);
  const setDraftPrompt = useOnboardingFlow((state) => state.setDraftPrompt);
  const setProviderId = useOnboardingFlow((state) => state.setProviderId);
  const goTo = useOnboardingFlow((state) => state.goTo);
  const goNext = useOnboardingFlow((state) => state.goNext);
  const goBack = useOnboardingFlow((state) => state.goBack);
  const reset = useOnboardingFlow((state) => state.reset);
  const complete = useCompleteOnboarding();
  const [confirmSkip, setConfirmSkip] = useState(false);
  const openSkipConfirm = () => setConfirmSkip(true);

  /** 收尾:落哨兵 → 撤流程 →(可选)切屏。写哨兵失败也不把用户困在引导里。 */
  const finish = (screen?: OnboardingScreenId) => {
    complete.mutate();
    setConfirmSkip(false);
    reset();
    if (screen) onOpenScreen?.(screen);
  };

  const sendToWorkbench = () => {
    const prompt = draftPrompt.trim();
    if (!prompt) return;
    // 只送草稿,不发起真实生图:发送权留给用户(承 pendingDraft 通道,ui-parity 04 P0)。
    useActiveSession.getState().setPendingDraft({
      prompt,
      negative: '',
      params: {},
      promptReferenceSelections: [],
      promptReferenceIds: [],
    });
    finish('workbench');
  };

  if (!gate.open) return null;

  return (
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        // Radix 只给 role=dialog(圈焦点 + 外部 aria-hidden);模态语义显式补 aria-modal。
        aria-modal="true"
        className="flex h-dvh w-full max-w-full flex-col gap-0 overflow-hidden rounded-none p-0 sm:max-w-full md:h-auto md:max-h-[min(46rem,90dvh)] md:max-w-[640px] md:rounded-lg"
        data-testid="onboarding-flow"
        data-step={step}
        // 点遮罩 / Esc = 跳过确认。内容换步卸焦点时 Radix 也会发 dismiss,
        // 不能走 onOpenChange(false),否则会误开跳过层甚至拆掉引导。
        onPointerDownOutside={(event) => {
          event.preventDefault();
          openSkipConfirm();
        }}
        onFocusOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          openSkipConfirm();
        }}
      >
        <DialogTitle className="sr-only">Musefold 首次设置</DialogTitle>
        <DialogDescription className="sr-only">
          连接一个生图通道,然后写下第一个方向
        </DialogDescription>

        <header className="flex shrink-0 items-center justify-between gap-3 border-b px-5 py-3 md:px-6">
          <div className="flex items-center gap-2">
            <MusefoldMark className="size-4 shrink-0 text-foreground" aria-hidden />
            <span className="font-semibold text-[13px] text-foreground">首次设置</span>
          </div>
          <OnboardingProgress step={step} />
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-6 md:py-6">
          {step === 'welcome' && (
            <OnboardingStepWelcome onStart={goNext} onSkip={openSkipConfirm} />
          )}
          {step === 'connect' && (
            <OnboardingStepConnect
              track={track}
              onSelectTrack={selectTrack}
              onConnected={({ providerId: created }) => {
                setProviderId(created ?? null);
                goTo('validate');
              }}
              onBack={goBack}
              onSkip={openSkipConfirm}
            />
          )}
          {step === 'validate' && (
            <OnboardingStepValidate
              track={track}
              providerId={providerId}
              onValidated={goNext}
              onBack={goBack}
              onSkip={openSkipConfirm}
            />
          )}
          {step === 'first-image' && (
            <OnboardingStepFirstImage
              prompt={draftPrompt}
              onPromptChange={setDraftPrompt}
              onSendToWorkbench={sendToWorkbench}
              onBack={goBack}
              onSkip={openSkipConfirm}
            />
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-center gap-1.5 border-t px-5 py-3 text-muted-foreground text-xs md:px-6">
          <LockKeyhole className="size-3" aria-hidden />
          本地优先 · 登录会话与密钥只保存在本机
        </footer>
      </DialogContent>

      <AlertDialog open={confirmSkip} onOpenChange={setConfirmSkip}>
        <AlertDialogContent className="max-w-sm" data-testid="onboarding-skip-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>跳过首次设置?</AlertDialogTitle>
            <AlertDialogDescription>
              以后可在设置中配置连接。在此之前没有可用生图通道,工作台暂时无法发送生成。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="onboarding-skip-cancel">继续设置</AlertDialogCancel>
            <AlertDialogAction onClick={() => finish()} data-testid="onboarding-skip-confirm">
              跳过
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
