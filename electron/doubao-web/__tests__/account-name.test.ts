import { describe, expect, it } from 'vitest';
import {
  isAllowedDoubaoAvatarUrl,
  pickDoubaoAccount,
  pickDoubaoAccountName,
  type DoubaoAccountNameCandidate,
} from '../account-name';

function candidate(patch: Partial<DoubaoAccountNameCandidate> = {}): DoubaoAccountNameCandidate {
  return {
    text: '李小白',
    ariaLabel: '个人账号',
    title: '',
    left: 20,
    top: 748,
    width: 180,
    height: 48,
    viewportWidth: 1120,
    viewportHeight: 820,
    tagName: 'BUTTON',
    avatarUrl: 'https://p9-passport.byteacctimg.com/img/user-avatar/example.png',
    hasAvatar: true,
    interactive: true,
    conversationItem: false,
    ...patch,
  };
}

describe('pickDoubaoAccountName', () => {
  it('selects the named account control at the bottom of the left rail', () => {
    expect(pickDoubaoAccountName([
      candidate({ text: '主对话', top: 390, tagName: 'A', hasAvatar: false, ariaLabel: '', conversationItem: true }),
      candidate({ text: '李小白\n›' }),
      candidate({ text: '更多', left: 610, ariaLabel: '' }),
    ])).toBe('李小白');
  });

  it('returns the matching Doubao avatar with the selected account', () => {
    expect(pickDoubaoAccount([candidate()])).toEqual({
      accountName: '李小白',
      avatarUrl: 'https://p9-passport.byteacctimg.com/img/user-avatar/example.png',
    });
  });

  it('rejects navigation and composer controls', () => {
    expect(pickDoubaoAccountName([
      candidate({ text: '设置', hasAvatar: false, ariaLabel: '' }),
      candidate({ text: '新对话', top: 120, hasAvatar: false, ariaLabel: '' }),
      candidate({ text: '', left: 430, width: 620, height: 96, hasAvatar: false, ariaLabel: '消息输入框' }),
    ])).toBeNull();
  });

  it('accepts only known HTTPS avatar hosts', () => {
    expect(isAllowedDoubaoAvatarUrl('https://p9-passport.byteacctimg.com/avatar.png')).toBe(true);
    expect(isAllowedDoubaoAvatarUrl('http://p9-passport.byteacctimg.com/avatar.png')).toBe(false);
    expect(isAllowedDoubaoAvatarUrl('https://example.com/avatar.png')).toBe(false);
    expect(isAllowedDoubaoAvatarUrl('https://byteacctimg.com.example.com/avatar.png')).toBe(false);
  });

  it('does not mistake a conversation link near the viewport edge for the account', () => {
    expect(pickDoubaoAccountName([
      candidate({
        text: '零基础练腹肌时间与计划',
        tagName: 'A',
        top: 763,
        height: 32,
        viewportHeight: 788,
        ariaLabel: '',
        conversationItem: true,
      }),
      candidate({ text: '李小白', top: 738, height: 36, viewportHeight: 788 }),
    ])).toBe('李小白');
  });
});
