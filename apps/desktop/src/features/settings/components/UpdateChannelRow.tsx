import { useState } from 'react';
import { Loader2 } from '../../../components/ui/icons';
import type {
  Channel,
  UpdateChannelInfo,
  UpdateChannelResult,
} from '@musefold/desktop-contracts/updater';
import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { ChoiceChips } from '../components/ChoiceChips';

export const CHANNEL_LABELS = {
  stable: '稳定版',
  beta: '测试版',
  dev: '开发版',
} as const satisfies Record<Channel, string>;

const CHANNEL_OPTIONS = (Object.keys(CHANNEL_LABELS) as Channel[]).map((value) => ({
  value,
  label: CHANNEL_LABELS[value],
}));

export function canRequestUpdateChannelChange(
  next: Channel,
  current: Channel,
  lockedByEnv: boolean,
): boolean {
  return !lockedByEnv && next !== current;
}

export async function commitUpdateChannelChange(
  next: Channel,
  options: {
    confirmed: boolean;
    lockedByEnv: boolean;
    setChannel: (channel: Channel) => Promise<UpdateChannelResult>;
  },
): Promise<UpdateChannelResult | null> {
  if (!options.confirmed || options.lockedByEnv) return null;
  return options.setChannel(next);
}

export function UpdateChannelRow({
  info,
  onCommit,
}: {
  info: UpdateChannelInfo;
  onCommit: (channel: Channel) => Promise<UpdateChannelResult>;
}) {
  const { channel, lockedByEnv } = info;
  const [pending, setPending] = useState<Channel | null>(null);
  const [busy, setBusy] = useState(false);
  const pendingLabel = pending ? CHANNEL_LABELS[pending] : '';

  const requestChange = (next: Channel) => {
    if (!canRequestUpdateChannelChange(next, channel, lockedByEnv)) return;
    setPending(next);
  };

  const closeDialog = (open: boolean) => {
    if (!open && !busy) setPending(null);
  };

  const confirmChange = async () => {
    if (!pending) return;
    const next = pending;
    setBusy(true);
    try {
      const result = await commitUpdateChannelChange(next, {
        confirmed: true,
        lockedByEnv,
        setChannel: onCommit,
      });
      if (result?.ok) setPending(null);
    } finally {
      setBusy(false);
    }
  };

  const description = lockedByEnv
    ? `已由环境变量 MUSEFOLD_UPDATE_CHANNEL 锁定为${CHANNEL_LABELS[channel]}，无法在设置中修改`
    : '稳定版面向正式用户；测试版与开发版面向测试者';

  return (
    <div
      className="settings-row flex items-center gap-6 py-[var(--density-setting-row-y)]"
      data-testid="about-update-channel"
    >
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium text-primary">更新通道</p>
        <p
          className="mt-0.5 text-[11px] leading-relaxed text-tertiary"
          data-testid={lockedByEnv ? 'about-channel-locked' : 'about-channel-hint'}
        >
          {description}
        </p>
      </div>
      {lockedByEnv ? (
        <span
          className="shrink-0 text-[12px] font-medium text-secondary"
          data-testid="about-channel-value"
        >
          {CHANNEL_LABELS[channel]}
        </span>
      ) : (
        <ChoiceChips
          aria-label="更新通道"
          value={channel}
          onChange={requestChange}
          options={CHANNEL_OPTIONS}
          testIdPrefix="about-channel"
        />
      )}

      <Dialog open={pending !== null} onOpenChange={closeDialog}>
        <DialogContent className="max-w-[460px]" data-testid="about-channel-dialog">
          <DialogHeader>
            <DialogTitle>切换更新通道？</DialogTitle>
            <DialogDescription>
              非稳定通道面向测试者，版本可能不稳定，且不保证能自动降级回稳定版。确认将更新源切换为「{pendingLabel}」吗？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              size="sm"
              variant="outline"
              onClick={() => closeDialog(false)}
              disabled={busy}
              data-testid="about-channel-cancel"
            >
              取消
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => void confirmChange()}
              disabled={busy}
              data-testid="about-channel-confirm"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              {busy ? '切换中…' : '确认切换'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
