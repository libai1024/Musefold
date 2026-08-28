import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IosDesignDemoView } from '../IosDesignDemoView';

describe('IosDesignDemoView', () => {
  it('renders the proposed workbench shell and primary creation controls', () => {
    const html = renderToStaticMarkup(<IosDesignDemoView />);

    expect(html).toContain('Musefold');
    expect(html).toContain('把想法变成画面');
    expect(html).toContain('图像提示词');
    expect(html).toContain('提示词库');
    expect(html).toContain('data-testid="demo-ratio-trigger"');
    expect(html).toContain('图片比例：1:1 方图');
    expect(html).toContain('data-testid="demo-generation-settings"');
    expect(html).toContain('生成设置：高清，4 张');
    expect(html).toContain('切换为亮色');
    expect(html).toContain('生成图片');
    expect(html).toContain('最近会话');
  });
});
