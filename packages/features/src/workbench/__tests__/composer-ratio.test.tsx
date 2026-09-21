import { generationAspectRatioSchema, type WorkbenchDraft } from '@musefold/contracts';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  Composer,
  type ComposerRatio,
  type ComposerValue,
  composerValueToDraft,
  draftToComposerValue,
  parseAspectRatio,
  toComposerRatio,
} from '../Composer';

const BASE_VALUE: ComposerValue = {
  prompt: '',
  negative: '',
  aspectRatio: 'auto',
  quality: 'auto',
  count: 1,
  promptReferenceSelections: [],
};

function draftWithRatio(aspectRatio: string): WorkbenchDraft {
  return {
    prompt: '',
    negative: '',
    params: { aspectRatio },
    promptReferenceSelections: [],
    promptReferenceIds: [],
  };
}

/** 受控宿主:与 WorkbenchScreen 同构,onChange 回灌 value。 */
function ComposerHarness({ aspectRatio = 'auto' }: { aspectRatio?: ComposerRatio }) {
  const [value, setValue] = useState<ComposerValue>({ ...BASE_VALUE, aspectRatio });
  return <Composer value={value} submitting={false} onChange={setValue} onSubmit={() => {}} />;
}

function openRatioPopover() {
  fireEvent.click(screen.getByTestId('composer-ratio'));
  return screen.getByTestId('composer-ratio-grid');
}

describe('自定义比例 draft round-trip(toComposerRatio / draft 双向)', () => {
  it('合法目录外 `7:3` 保留为 `7:3`,composerValueToDraft 原样写回', () => {
    expect(toComposerRatio('7:3')).toBe('7:3');
    expect(draftToComposerValue(draftWithRatio('7:3')).aspectRatio).toBe('7:3');
    const draft = composerValueToDraft({ ...BASE_VALUE, aspectRatio: '7:3' });
    expect(draft.params.aspectRatio).toBe('7:3');
  });

  it('等价比例在 UI/草稿入口约分为同一 canonical 值', () => {
    expect(parseAspectRatio('2:8')).toEqual({ w: 1, h: 4 });
    expect(parseAspectRatio('24:96')).toEqual({ w: 1, h: 4 });
    expect(toComposerRatio('2:8')).toBe('1:4');
    expect(draftToComposerValue(draftWithRatio('24:96')).aspectRatio).toBe('1:4');
    expect(toComposerRatio('7:3')).toBe('7:3');
  });

  it('非法值回落 auto:超界 `99:1` / 零值 / 旧 `custom:` 前缀 / 非比例串', () => {
    expect(toComposerRatio('99:1')).toBe('auto');
    expect(draftToComposerValue(draftWithRatio('99:1')).aspectRatio).toBe('auto');
    expect(toComposerRatio('1:5')).toBe('auto');
    expect(toComposerRatio('0:0')).toBe('auto');
    expect(toComposerRatio('01:04')).toBe('auto');
    expect(toComposerRatio('16:09')).toBe('auto');
    expect(toComposerRatio('custom:7:3')).toBe('auto');
    expect(toComposerRatio('wide')).toBe('auto');
    expect(toComposerRatio(undefined)).toBe('auto');
  });

  it('UI 解析与 create 契约保持 canonical W:H 一致', () => {
    for (const value of ['1:4', '4:1', '16:9', '7:3', '2:8', '24:96', '96:24']) {
      expect(parseAspectRatio(value)).not.toBeNull();
      expect(generationAspectRatioSchema.safeParse(value).success).toBe(true);
    }
    for (const value of ['01:04', '16:09', '00:01', '1:5', '99:1', 'custom:7:3']) {
      expect(parseAspectRatio(value)).toBeNull();
      expect(generationAspectRatioSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe('Composer 自定义比例行(承旧 v2.1 RatioPicker)', () => {
  it('合法 7:3 应用:trigger/preview/标题更新,popover 关闭,草稿值写回', async () => {
    render(<ComposerHarness />);
    openRatioPopover();

    fireEvent.change(screen.getByTestId('composer-ratio-custom-w'), { target: { value: '7' } });
    fireEvent.change(screen.getByTestId('composer-ratio-custom-h'), { target: { value: '3' } });
    fireEvent.click(screen.getByTestId('composer-ratio-custom-apply'));

    // 应用即关弹层。
    await waitFor(() => {
      expect(screen.queryByTestId('composer-ratio-grid')).toBeNull();
    });
    // trigger 显示实际 W:H,不回落 auto;aria-label 标自定义。
    const trigger = screen.getByTestId('composer-ratio');
    expect(trigger.textContent).toContain('7:3');
    expect(trigger.getAttribute('aria-label')).toBe('图片比例:7:3 自定义');
    // RatioPreview 按 7:3 画形状(26px 基准边:26 × round(26·3/7)=11)。
    const preview = trigger.querySelector('span[aria-hidden="true"]') as HTMLElement;
    expect(preview.style.width).toBe('26px');
    expect(preview.style.height).toBe('11px');

    // 重开:标题右侧「7:3 / 自定义」,输入预填,目录无选中项,自定义行标「当前」。
    openRatioPopover();
    expect(screen.getByText('7:3 / 自定义')).toBeTruthy();
    expect(screen.getByText('自定义 · 当前')).toBeTruthy();
    expect((screen.getByTestId('composer-ratio-custom-w') as HTMLInputElement).value).toBe('7');
    expect((screen.getByTestId('composer-ratio-custom-h') as HTMLInputElement).value).toBe('3');
    expect(
      within(screen.getByTestId('composer-ratio-grid')).queryAllByRole('option', {
        selected: true,
      }),
    ).toHaveLength(0);
  });

  it('等价自定义比例应用后触发器与草稿使用约分值', async () => {
    render(<ComposerHarness />);
    openRatioPopover();

    fireEvent.change(screen.getByTestId('composer-ratio-custom-w'), { target: { value: '2' } });
    fireEvent.change(screen.getByTestId('composer-ratio-custom-h'), { target: { value: '8' } });
    fireEvent.click(screen.getByTestId('composer-ratio-custom-apply'));

    await waitFor(() => {
      expect(screen.queryByTestId('composer-ratio-grid')).toBeNull();
    });
    expect(screen.getByTestId('composer-ratio').textContent).toContain('1:4');
  });

  it('非法 9:1:Enter 后 role=alert 且 popover 保持打开,trigger 不变', async () => {
    render(<ComposerHarness />);
    openRatioPopover();

    fireEvent.change(screen.getByTestId('composer-ratio-custom-w'), { target: { value: '9' } });
    fireEvent.change(screen.getByTestId('composer-ratio-custom-h'), { target: { value: '1' } });
    fireEvent.keyDown(screen.getByTestId('composer-ratio-custom-h'), { key: 'Enter' });

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('比例需在 1:4 与 4:1 之间');
    expect(alert.getAttribute('data-testid')).toBe('composer-ratio-custom-error');
    // popover 保持打开,值未被应用。
    expect(screen.getByTestId('composer-ratio-grid')).toBeTruthy();
    expect(screen.getByTestId('composer-ratio').textContent).toContain('auto');

    // 点击路径同语义:清空重输非法值后点「应用」仍报错不关弹层。
    fireEvent.change(screen.getByTestId('composer-ratio-custom-w'), { target: { value: '1' } });
    fireEvent.change(screen.getByTestId('composer-ratio-custom-h'), { target: { value: '9' } });
    fireEvent.click(screen.getByTestId('composer-ratio-custom-apply'));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByTestId('composer-ratio-grid')).toBeTruthy();
  });

  it('leading zero 01:04 不写入草稿:显示错误并保持弹层与 trigger', () => {
    render(<ComposerHarness />);
    openRatioPopover();

    fireEvent.change(screen.getByTestId('composer-ratio-custom-w'), { target: { value: '01' } });
    fireEvent.change(screen.getByTestId('composer-ratio-custom-h'), { target: { value: '04' } });
    fireEvent.click(screen.getByTestId('composer-ratio-custom-apply'));

    expect(screen.getByRole('alert').textContent).toBe('比例需在 1:4 与 4:1 之间');
    expect(screen.getByTestId('composer-ratio-grid')).toBeTruthy();
    expect(screen.getByTestId('composer-ratio').textContent).toContain('auto');
  });

  it('空值「应用」禁用;输入清洗只留数字最多 2 位;Enter 应用合法值', async () => {
    render(<ComposerHarness />);
    openRatioPopover();

    const apply = screen.getByTestId('composer-ratio-custom-apply') as HTMLButtonElement;
    expect(apply.disabled).toBe(true);

    // 清洗:非数字剔除、超 2 位截断(承旧 replace(/\D/g).slice(0,2))。
    const width = screen.getByTestId('composer-ratio-custom-w') as HTMLInputElement;
    const height = screen.getByTestId('composer-ratio-custom-h') as HTMLInputElement;
    fireEvent.change(width, { target: { value: 'a7b' } });
    expect(width.value).toBe('7');
    fireEvent.change(height, { target: { value: 'x3y' } });
    expect(height.value).toBe('3');
    fireEvent.change(width, { target: { value: '163' } });
    expect(width.value).toBe('16');
    // 16:3 超界(>4:1),Enter 应用被拒。
    fireEvent.keyDown(width, { key: 'Enter' });
    expect(screen.getByRole('alert')).toBeTruthy();

    fireEvent.change(width, { target: { value: '7' } });
    fireEvent.keyDown(width, { key: 'Enter' });
    await waitFor(() => {
      expect(screen.queryByTestId('composer-ratio-grid')).toBeNull();
    });
    expect(screen.getByTestId('composer-ratio').textContent).toContain('7:3');
  });

  it('预设选择仍工作;切换预设后自定义草稿保留但不被误当当前值', async () => {
    render(<ComposerHarness />);
    openRatioPopover();

    // 输到一半的自定义草稿,改选预设。
    fireEvent.change(screen.getByTestId('composer-ratio-custom-w'), { target: { value: '7' } });
    fireEvent.change(screen.getByTestId('composer-ratio-custom-h'), { target: { value: '3' } });
    fireEvent.click(screen.getByTestId('composer-ratio-16x9'));

    await waitFor(() => {
      expect(screen.getByTestId('composer-ratio').textContent).toContain('16:9');
    });
    expect(screen.getByTestId('composer-ratio').getAttribute('aria-label')).toBe(
      '图片比例:16:9 宽屏',
    );

    // 重开:草稿保留在输入里,但当前态是预设(标题显示预设标签,不标「当前」)。
    openRatioPopover();
    expect((screen.getByTestId('composer-ratio-custom-w') as HTMLInputElement).value).toBe('7');
    expect(screen.getByText('自定义')).toBeTruthy();
    expect(screen.queryByText('自定义 · 当前')).toBeNull();
    expect(screen.getByTestId('composer-ratio-16x9').getAttribute('aria-selected')).toBe('true');
  });

  it('auto 当前态打开不预填自定义输入(不把 auto 当自定义)', () => {
    render(<ComposerHarness aspectRatio="auto" />);
    openRatioPopover();
    expect((screen.getByTestId('composer-ratio-custom-w') as HTMLInputElement).value).toBe('');
    expect((screen.getByTestId('composer-ratio-custom-h') as HTMLInputElement).value).toBe('');
    expect(screen.getByText('由模型决定')).toBeTruthy();
  });
});

describe('Composer Prompt 引用提交门禁', () => {
  it('只有引用时仍可提交,正文输入上限与 create contract 一致', () => {
    const onSubmit = vi.fn();
    render(
      <Composer
        value={{
          ...BASE_VALUE,
          promptReferenceSelections: [{ promptId: 'prompt-1', scope: 'full', expectedVersion: 1 }],
        }}
        submitting={false}
        onChange={() => {}}
        onSubmit={onSubmit}
      />,
    );

    const prompt = screen.getByTestId('composer-prompt') as HTMLTextAreaElement;
    const submit = screen.getByTestId('composer-submit') as HTMLButtonElement;
    expect(prompt.maxLength).toBe(8_000);
    fireEvent.click(screen.getByTestId('composer-settings'));
    const negative = screen.getByTestId('composer-negative') as HTMLTextAreaElement;
    expect(negative.maxLength).toBe(4_000);
    expect(submit.disabled).toBe(false);

    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('存量超限草稿保持可见但在本地阻断提交并给出恢复提示', () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <Composer
        value={{ ...BASE_VALUE, prompt: 'x'.repeat(8_001) }}
        submitting={false}
        onChange={() => {}}
        onSubmit={onSubmit}
      />,
    );

    expect((screen.getByTestId('composer-submit') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('composer-length-error').textContent).toBe(
      '提示词超过 8000 字限制,请缩短后再生成',
    );
    fireEvent.click(screen.getByTestId('composer-submit'));
    expect(onSubmit).not.toHaveBeenCalled();

    rerender(
      <Composer
        value={{ ...BASE_VALUE, prompt: '可提交', negative: 'x'.repeat(4_001) }}
        submitting={false}
        onChange={() => {}}
        onSubmit={onSubmit}
      />,
    );
    expect((screen.getByTestId('composer-submit') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('composer-length-error').textContent).toBe(
      '反向提示词超过 4000 字限制,请缩短后再生成',
    );
  });
});
