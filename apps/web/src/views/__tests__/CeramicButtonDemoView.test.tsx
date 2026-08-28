import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CeramicButtonDemoView } from '../CeramicButtonDemoView';

describe('CeramicButtonDemoView', () => {
  it('renders one branded ceramic action button in the operate register', () => {
    const html = renderToStaticMarkup(<CeramicButtonDemoView />);

    expect(html).toContain('class="mf-ceramic-button-demo"');
    expect(html).toContain('data-ui-register="operate"');
    expect(html).toContain('data-testid="ceramic-button"');
    expect(html).toContain('type="button"');
    expect(html).toContain('开始创作');
    expect((html.match(/<button\b/g) ?? []).length).toBe(1);
  });
});
