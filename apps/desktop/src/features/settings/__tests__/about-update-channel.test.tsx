import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Channel, UpdateChannelResult } from '@musefold/desktop-contracts/updater';
import {
  canRequestUpdateChannelChange,
  commitUpdateChannelChange,
  UpdateChannelRow,
} from '../sections/UpdateChannelRow';

function setChannelMock() {
  return vi.fn(async (channel: Channel): Promise<UpdateChannelResult> => ({
    ok: true,
    channel,
    lockedByEnv: false,
  }));
}

describe('about update channel row', () => {
  it('does not call set before the user confirms', async () => {
    const setChannel = setChannelMock();
    const html = renderToStaticMarkup(
      <UpdateChannelRow
        info={{ channel: 'stable', lockedByEnv: false }}
        onCommit={setChannel}
      />,
    );
    expect(html).toContain('data-testid="about-update-channel"');
    expect(html).toContain('data-testid="about-channel-beta"');
    expect(html).not.toContain('data-testid="about-channel-dialog"');
    expect(setChannel).not.toHaveBeenCalled();

    await expect(
      commitUpdateChannelChange('beta', {
        confirmed: false,
        lockedByEnv: false,
        setChannel,
      }),
    ).resolves.toBeNull();
    expect(setChannel).not.toHaveBeenCalled();
    expect(canRequestUpdateChannelChange('beta', 'stable', false)).toBe(true);
  });

  it('calls set after confirmation', async () => {
    const setChannel = setChannelMock();
    const result = await commitUpdateChannelChange('beta', {
      confirmed: true,
      lockedByEnv: false,
      setChannel,
    });
    expect(result).toEqual({ ok: true, channel: 'beta', lockedByEnv: false });
    expect(setChannel).toHaveBeenCalledTimes(1);
    expect(setChannel).toHaveBeenCalledWith('beta');
  });

  it('is read-only when the environment variable locks the channel', async () => {
    const setChannel = setChannelMock();
    const html = renderToStaticMarkup(
      <UpdateChannelRow
        info={{ channel: 'dev', lockedByEnv: true }}
        onCommit={setChannel}
      />,
    );
    expect(html).toContain('data-testid="about-channel-locked"');
    expect(html).toContain('MUSEFOLD_UPDATE_CHANNEL');
    expect(html).toContain('data-testid="about-channel-value"');
    expect(html).toContain('开发版');
    expect(html).not.toContain('data-testid="about-channel-beta"');
    expect(html).not.toContain('role="radiogroup"');
    expect(canRequestUpdateChannelChange('beta', 'dev', true)).toBe(false);
    await expect(
      commitUpdateChannelChange('beta', {
        confirmed: true,
        lockedByEnv: true,
        setChannel,
      }),
    ).resolves.toBeNull();
    expect(setChannel).not.toHaveBeenCalled();
  });
});
