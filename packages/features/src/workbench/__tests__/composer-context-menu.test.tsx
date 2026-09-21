import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Composer, type ComposerReference, type ComposerValue } from '../Composer';
import type { PromptReferenceResolution } from '../prompt-references';

const BASE_VALUE: ComposerValue = {
  prompt: '',
  negative: '',
  aspectRatio: 'auto',
  quality: 'auto',
  count: 1,
  promptReferenceSelections: [],
};

function makeResolution(
  key: string,
  overrides: Partial<PromptReferenceResolution> = {},
): PromptReferenceResolution {
  return {
    key,
    intent: { promptId: key, scope: 'full', expectedVersion: 1 },
    status: 'ready',
    title: `标题 ${key}`,
    preview: '解析出的引用正文预览',
    scopeLabel: '引用提示词 · 整条',
    ...overrides,
  };
}

/** 惰性 data URL(jsdom 不加载但 src 非空,避免空 src 警告)。 */
const INERT_PREVIEW_URL = 'data:image/png;base64,iVBORw0KGgo=';

function makeImageReference(
  key: string,
  status: 'uploading' | 'ready' = 'ready',
): ComposerReference {
  return { key, status, name: `${key}.png`, previewUrl: INERT_PREVIEW_URL };
}

interface HarnessProps {
  promptReferences?: PromptReferenceResolution[];
  references?: ComposerReference[];
  onOpenPromptReferences?: () => void;
  onAddImages?: (files: File[]) => void;
}

/** 受控宿主:移除回调真实回灌 state,验证 Backspace 弹出顺序。 */
function ComposerHarness({
  promptReferences: initialPromptReferences = [],
  references: initialReferences = [],
  onOpenPromptReferences,
  onAddImages,
}: HarnessProps) {
  const [value, setValue] = useState<ComposerValue>(BASE_VALUE);
  const [promptReferences, setPromptReferences] = useState(initialPromptReferences);
  const [references, setReferences] = useState(initialReferences);
  return (
    <Composer
      value={value}
      submitting={false}
      references={references}
      promptReferences={promptReferences}
      onChange={setValue}
      onSubmit={() => {}}
      onAddImages={onAddImages ?? (() => {})}
      onRemoveReference={(key) =>
        setReferences((prev) => prev.filter((reference) => reference.key !== key))
      }
      onRemovePromptReference={(key) =>
        setPromptReferences((prev) => prev.filter((reference) => reference.key !== key))
      }
      onOpenPromptReferences={onOpenPromptReferences}
    />
  );
}

describe('Composer「添加上下文」菜单(承旧「+」菜单扩展)', () => {
  it('触发钮保留 composer-attach,根 testid/aria/菜单项契约齐全', async () => {
    render(<ComposerHarness onOpenPromptReferences={() => {}} />);
    const trigger = screen.getByTestId('composer-attach');
    expect(trigger.getAttribute('aria-label')).toBe('添加上下文');
    expect(trigger.getAttribute('title')).toBe('添加上下文');
    expect(screen.getByTestId('workbench-context-menu')).toBeTruthy();

    await userEvent.click(trigger);
    const menu = await screen.findByRole('menu');
    expect(menu.getAttribute('aria-label')).toBe('添加上下文菜单');
    // 图片动作保留(新 testid),提示词动作带提示语。
    expect(screen.getByTestId('workbench-image-picker').textContent).toContain('添加图片');
    const promptItem = screen.getByTestId('workbench-context-ref-prompt');
    expect(promptItem.textContent).toContain('提示词');
    expect(promptItem.textContent).toContain('从库中引用');
  });

  it('「提示词」动作回调打开参考素材面板', async () => {
    const onOpenPromptReferences = vi.fn();
    render(<ComposerHarness onOpenPromptReferences={onOpenPromptReferences} />);
    await userEvent.click(screen.getByTestId('composer-attach'));
    await userEvent.click(await screen.findByTestId('workbench-context-ref-prompt'));
    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull();
      expect(onOpenPromptReferences).toHaveBeenCalledTimes(1);
    });
  });

  it('无引用处理器时「提示词」项禁用;图片动作仍可进入', async () => {
    render(<ComposerHarness />);
    await userEvent.click(screen.getByTestId('composer-attach'));
    expect(
      (await screen.findByTestId('workbench-context-ref-prompt')).getAttribute('aria-disabled'),
    ).toBe('true');
    expect(screen.getByTestId('workbench-image-picker').getAttribute('aria-disabled')).not.toBe(
      'true',
    );
  });
});

describe('Composer 上下文托盘(提示词引用卡)', () => {
  it('渲染标签/卡片/副标/预览;移除钮可达性命名按解析标题', () => {
    render(
      <ComposerHarness
        promptReferences={[
          makeResolution('p-1', { title: '都市夜景' }),
          makeResolution('p-2', {
            title: '产品主视觉',
            scopeLabel: '引用提示词 · 选中片段',
            preview: '选中的一段正文',
          }),
        ]}
      />,
    );
    const tray = screen.getByTestId('workbench-context-tray');
    expect(tray.getAttribute('aria-label')).toBe('上下文');
    expect(within(tray).getByText('上下文')).toBeTruthy();
    const cards = screen.getAllByTestId('prompt-reference-card');
    expect(cards).toHaveLength(2);
    expect(cards[0]?.textContent).toContain('都市夜景');
    expect(cards[0]?.textContent).toContain('引用提示词 · 整条');
    expect(cards[1]?.textContent).toContain('引用提示词 · 选中片段');
    const previews = screen.getAllByTestId('prompt-reference-preview');
    expect(previews[1]?.textContent).toBe('选中的一段正文');

    const remove = screen.getByLabelText('移除来源：都市夜景');
    expect(remove.getAttribute('title')).toBe('移除来源');
  });

  it('unavailable/stale 状态可见且可移除(不伪造内容)', () => {
    render(
      <ComposerHarness
        promptReferences={[
          makeResolution('gone', {
            status: 'unavailable',
            title: '提示词不可用',
            preview: '源提示词已删除或不可访问,可移除这条引用。',
          }),
          makeResolution('stale', { status: 'stale', title: '源已改版' }),
        ]}
      />,
    );
    const unavailable = screen.getAllByTestId('prompt-reference-card')[0] as HTMLElement;
    expect(unavailable.getAttribute('data-status')).toBe('unavailable');
    expect(unavailable.textContent).toContain('提示词不可用');
    expect(unavailable.textContent).toContain('已删除或不可访问');
    const stale = screen.getAllByTestId('prompt-reference-card')[1] as HTMLElement;
    expect(stale.getAttribute('data-status')).toBe('stale');
    expect(stale.textContent).toContain('源已更新');
    // 两者都可移除。
    expect(screen.getByLabelText('移除来源：提示词不可用')).toBeTruthy();
    expect(screen.getByLabelText('移除来源：源已改版')).toBeTruthy();
  });

  it('点击移除钮回调对应 key', () => {
    const onRemove = vi.fn();
    const refs = [makeResolution('p-1', { title: '甲' }), makeResolution('p-2', { title: '乙' })];
    function Harness() {
      const [value, setValue] = useState(BASE_VALUE);
      return (
        <Composer
          value={value}
          submitting={false}
          promptReferences={refs}
          onChange={setValue}
          onSubmit={() => {}}
          onRemovePromptReference={onRemove}
        />
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByLabelText('移除来源：乙'));
    expect(onRemove).toHaveBeenCalledWith('p-2');
  });

  it('仅引用(无正文)时发送钮可用', () => {
    function Harness() {
      const [value, setValue] = useState<ComposerValue>({
        ...BASE_VALUE,
        promptReferenceSelections: [{ promptId: 'p-1', scope: 'full', expectedVersion: 1 }],
      });
      return <Composer value={value} submitting={false} onChange={setValue} onSubmit={() => {}} />;
    }
    render(<Harness />);
    expect((screen.getByTestId('composer-submit') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('Composer 行首 Backspace 弹出顺序(确定序:先就绪参考图,再最新引用卡)', () => {
  it('先弹参考图,再弹最新提示词引用;引用从后往前逐个弹出', () => {
    render(
      <ComposerHarness
        references={[makeImageReference('img-1')]}
        promptReferences={[makeResolution('p-1'), makeResolution('p-2')]}
      />,
    );
    const prompt = screen.getByTestId('composer-prompt');

    // 第一次:弹出就绪参考图(既有行为保留)。
    fireEvent.keyDown(prompt, { key: 'Backspace' });
    expect(screen.queryByTestId('composer-reference')).toBeNull();
    expect(screen.getAllByTestId('prompt-reference-card')).toHaveLength(2);

    // 第二次:弹出最新引用 p-2。
    fireEvent.keyDown(prompt, { key: 'Backspace' });
    const remaining = screen.getAllByTestId('prompt-reference-card');
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.textContent).toContain('标题 p-1');

    // 第三次:弹出 p-1,托盘消失。
    fireEvent.keyDown(prompt, { key: 'Backspace' });
    expect(screen.queryByTestId('workbench-context-tray')).toBeNull();
  });

  it('无参考图时直接弹最新引用;参考图上传中不挡引用弹出', () => {
    render(
      <ComposerHarness
        references={[makeImageReference('img-uploading', 'uploading')]}
        promptReferences={[makeResolution('p-1')]}
      />,
    );
    const prompt = screen.getByTestId('composer-prompt');
    fireEvent.keyDown(prompt, { key: 'Backspace' });
    // 上传中的参考图不动,引用卡弹出。
    expect(screen.getByTestId('composer-reference')).toBeTruthy();
    expect(screen.queryByTestId('workbench-context-tray')).toBeNull();
  });
});
