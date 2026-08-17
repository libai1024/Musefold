import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sidebar = readFileSync('src/components/layout/Sidebar.tsx', 'utf8');

describe('recent conversation actions', () => {
  it('uses direct pin and archive hover actions instead of a more button', () => {
    expect(sidebar).toContain('data-testid="conversation-hover-pin"');
    expect(sidebar).toContain('data-testid="conversation-hover-archive"');
    expect(sidebar).not.toContain('MoreHorizontal');
    expect(sidebar).not.toContain('管理对话：');
  });

  it('renders a viewport-aware glass context menu through a body portal', () => {
    expect(sidebar).toContain('createPortal(');
    expect(sidebar).toContain('document.body');
    expect(sidebar).toContain('data-conversation-context-menu');
    expect(sidebar).toContain('window.innerWidth - rect.width - 8');
    expect(sidebar).toContain('window.innerHeight - rect.height - 8');
    expect(sidebar).toContain('backdrop-blur-xl');
    expect(sidebar).toContain('z-[1000]');
  });

  it('offers the requested context actions without displaying a title header', () => {
    expect(sidebar).toContain("pinned ? '取消置顶聊天' : '置顶聊天'");
    expect(sidebar).toContain('<span>重命名聊天</span>');
    expect(sidebar).toContain('<span>归档聊天</span>');
    expect(sidebar).toContain('<span>标记为未读</span>');
    expect(sidebar).not.toContain('title={title}>{title}</p>');
  });

  it('puts pinned chats in their own group without an inline pin marker', () => {
    expect(sidebar).toContain("{ label: '置顶' as const, items: pinned }");
    expect(sidebar).not.toContain('{pinned && <Pin');
  });

  it('shows a leading status glow instead of conversation type icons', () => {
    expect(sidebar).not.toContain('ConversationTypeIcon');
    expect(sidebar).not.toContain('conversation-type-indicator');
    expect(sidebar).toContain('data-testid="conversation-status-dot"');
    expect(sidebar).toContain("running ? 'conversation-glow-running' : 'conversation-glow-unread'");
    expect(sidebar).toContain("data-status={running ? 'running' : 'unread'}");
  });
});
