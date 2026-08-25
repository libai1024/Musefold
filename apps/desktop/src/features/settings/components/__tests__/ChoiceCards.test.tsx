import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChoiceCards } from '../ChoiceCards';

describe('ChoiceCards', () => {
  it('renders rich choices with one accessible selected radio', () => {
    const html = renderToStaticMarkup(
      <ChoiceCards
        value="merge"
        onChange={() => undefined}
        aria-label="导入策略"
        testIdPrefix="import-strategy"
        options={[
          { value: 'merge', title: '合并', description: '保留本地内容。' },
          { value: 'replace', title: '替换', description: '清空后写入。', danger: true },
        ]}
      />,
    );

    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="导入策略"');
    expect(html).toContain('data-testid="import-strategy-merge"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('rounded-md');
    expect(html).toContain('保留本地内容。');
  });
});
