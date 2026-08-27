import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Channel, UpdateChannelResult } from '@musefold/desktop-contracts/updater';
import {
  canRequestUpdateChannelChange,
  commitUpdateChannelChange,
  UpdateChannelRow,
} from '../components/UpdateChannelRow';
import { UpdateRow } from '../components/AboutUpdateRow';

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

describe('about update row initial state (settings review)', () => {
  it('renders an honest unchecked initial state with polite live semantics', () => {
    const html = renderToStaticMarkup(
      <UpdateRow status={null} channel="stable" onAction={() => undefined} />,
    );
    expect(html).toContain('data-testid="about-updater"');
    // getState 返回前是「未检查更新」,不再谎报「正在检查」
    expect(html).toContain('未检查更新');
    expect(html).not.toContain('正在检查更新');
    expect(html).toContain('aria-live="polite"');
    // 下载/版本数字 tabular figures(DESIGN.md job progress 条款)
    expect(html).toContain('tabular-nums');
  });

  it('lists only wired shortcuts and scopes composer Enter keys', () => {
    const aboutSection = readFileSync(
      'apps/desktop/src/features/settings/components/AboutSection.tsx',
      'utf8',
    );
    // ⌘F 未接全局监听不展示;Enter 系标注「工作台输入框」作用域
    expect(aboutSection).toContain("new Set(['search'])");
    expect(aboutSection).toContain('工作台输入框');
    expect(aboutSection).toContain('PRODUCT_SHORTCUTS.filter');
  });
});
