import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CeramicButtonDemo } from '../ceramic-button-demo';

describe('CeramicButtonDemo', () => {
  it('renders a single branded button without the product shell', () => {
    const html = renderToStaticMarkup(<CeramicButtonDemo />);

    expect(html).toContain('data-ui-register="operate"');
    expect(html).toContain('data-testid="ceramic-button"');
    expect(html).toContain('开始创作');
    expect(html).toContain('type="button"');
    expect((html.match(/<button\b/g) ?? []).length).toBe(1);
  });
});
