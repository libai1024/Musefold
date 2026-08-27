import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Field, RouteButton } from '../AiConnectionDialogParts';

describe('AiConnectionDialogParts', () => {
  it('keeps the extracted form primitives semantic and compact', () => {
    const html = renderToStaticMarkup(
      <>
        <Field label="模型" hint="可手工填写模型 ID">
          <input aria-label="模型" />
        </Field>
        <RouteButton active onClick={() => undefined}>
          兼容网关
        </RouteButton>
      </>,
    );

    expect(html).toContain('可手工填写模型 ID');
    // 连接方式选择升级为 radiogroup 语义(role=radio + aria-checked)。
    expect(html).toContain('role="radio"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('兼容网关');
  });
});
