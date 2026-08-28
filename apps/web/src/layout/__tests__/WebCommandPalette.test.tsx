import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getProductCapabilities } from '@musefold/domain';
import { WebCommandPalette, webCommandTargetView } from '../WebCommandPalette';

const props = {
  onOpenChange: () => undefined,
  capabilities: getProductCapabilities('web'),
  sessions: [],
  prompts: [],
  onNewDesign: () => undefined,
  onNavigate: () => undefined,
  onOpenSession: () => undefined,
  onUsePrompt: () => undefined,
};

describe('webCommandTargetView', () => {
  it('maps the shared command catalog targets onto Web view keys', () => {
    expect(webCommandTargetView('library')).toBe('prompts');
    expect(webCommandTargetView('history')).toBe('history');
    expect(webCommandTargetView('settings')).toBe('settings');
    expect(webCommandTargetView(undefined)).toBe('generate');
  });
});

describe('WebCommandPalette', () => {
  it('renders nothing while closed so the host stays clean', () => {
    // Radix Dialog 关闭态不输出 portal 内容；关闭时不得泄漏面板标记。
    expect(renderToStaticMarkup(<WebCommandPalette open={false} {...props} />)).toBe('');
  });
});
