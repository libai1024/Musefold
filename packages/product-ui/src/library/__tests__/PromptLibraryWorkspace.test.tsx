import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PromptLibraryWorkspace } from '../PromptLibraryWorkspace';

describe('PromptLibraryWorkspace', () => {
  it('keeps list and labelled Inspector slots in one shared workspace', () => {
    const html = renderToStaticMarkup(
      <PromptLibraryWorkspace
        detailOpen
        onClose={() => undefined}
        list={<div data-testid="prompt-list-slot">列表</div>}
        detail={<div data-testid="prompt-detail-slot">详情</div>}
      />,
    );

    expect(html).toContain('data-testid="prompt-library-workspace"');
    expect(html).toContain('data-detail-open="true"');
    expect(html).toContain('data-testid="prompt-list-slot"');
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="提示词列表"');
    expect(html).toContain('data-testid="prompt-inspector"');
    expect(html).toContain('aria-label="提示词详情"');
    expect(html).toContain('data-testid="prompt-detail-slot"');
    expect(html).toContain('data-testid="detail-back"');
    expect(html).toContain('关闭提示词详情');
  });

  it('keeps the closed Inspector hidden and unmounted', () => {
    const html = renderToStaticMarkup(
      <PromptLibraryWorkspace
        detailOpen={false}
        onClose={() => undefined}
        list={<div>列表</div>}
        detail={<div data-testid="prompt-detail-slot">详情</div>}
      />,
    );

    expect(html).toContain('data-detail-open="false"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('data-testid="prompt-detail-slot"');
    expect(html).not.toContain('data-testid="detail-back"');
  });
});
