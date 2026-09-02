import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { SchemeComposerAttachment } from '../../design-schemes/integration-store';
import { Composer, type ComposerSchemeProps, type ComposerValue } from '../Composer';

const user = userEvent.setup({ pointerEventsCheck: 0 });

const BASE_VALUE: ComposerValue = {
  prompt: '',
  negative: '',
  aspectRatio: 'auto',
  quality: 'auto',
  promptReferenceSelections: [],
};

function makeAttachment(
  overrides: Partial<SchemeComposerAttachment> = {},
): SchemeComposerAttachment {
  return {
    schemeId: 'scheme-1',
    revisionId: 'rev-1',
    name: '水彩海报',
    summary: '柔和水彩质感的活动海报配方',
    mode: 'formal',
    fidelity: 'faithful',
    sourceLabel: 'Musefold 创建',
    inputs: [],
    coverAssetId: null,
    hasSuccessfulTrial: true,
    ...overrides,
  };
}

interface HarnessOptions {
  scheme?: Partial<ComposerSchemeProps>;
  initialPrompt?: string;
}

/** 受控宿主:方案回调真实回灌 state,验证收集/清除闭环。 */
function ComposerSchemeHarness({ scheme, initialPrompt = '' }: HarnessOptions) {
  const [value, setValue] = useState<ComposerValue>({ ...BASE_VALUE, prompt: initialPrompt });
  const [attachment, setAttachment] = useState<SchemeComposerAttachment | null>(
    scheme?.attachment ?? null,
  );
  const [creation, setCreation] = useState(scheme?.creation ?? null);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const onSubmit = vi.fn();
  return (
    <Composer
      value={value}
      submitting={false}
      onChange={setValue}
      onSubmit={onSubmit}
      scheme={
        scheme
          ? {
              submitDisabledReason: null,
              ...scheme,
              // 受控键永远以 state 为准(清除/收集要真实回灌)。
              attachment,
              creation,
              inputValues,
              onChangeInput: (slotId, next) =>
                setInputValues((prev) => ({ ...prev, [slotId]: next })),
              onClearAttachment: () => {
                setAttachment(null);
                setInputValues({});
              },
              onClearCreation: () => setCreation(null),
            }
          : undefined
      }
    />
  );
}

describe('Composer「+」菜单方案项(设计方案域恢复;Skill 运行时仍暂缓)', () => {
  it('scheme 接缝齐备:四个方案项带承旧文案/提示;Skill 项不出现', async () => {
    render(
      <ComposerSchemeHarness
        scheme={{
          onOpenPicker: vi.fn(),
          onStartCreation: vi.fn(),
          onOpenHistorySource: vi.fn(),
          onOpenDesignSchemes: vi.fn(),
        }}
      />,
    );
    await user.click(screen.getByTestId('composer-attach'));
    const picker = await screen.findByTestId('workbench-context-ref-scheme');
    expect(picker.textContent).toContain('设计方案');
    expect(picker.textContent).toContain('套用视觉方向');
    const create = screen.getByTestId('composer-menu-design-plan');
    expect(create.textContent).toContain('生成设计方案');
    expect(create.textContent).toContain('先出草稿');
    const history = screen.getByTestId('workbench-context-history-source');
    expect(history.textContent).toContain('从历史内容创建');
    expect(history.textContent).toContain('自行选择来源');
    const find = screen.getByTestId('workbench-context-find-scheme');
    expect(find.textContent).toContain('寻找设计方案');
    expect(find.textContent).toContain('打开方案库');
    // 暂缓域不出现:GitHub Skill 菜单项不恢复。
    expect(screen.queryByText('GitHub Skill')).toBeNull();
  });

  it('scheme 缺省(域未恢复):方案项完全不出现(D2),原有项不受影响', async () => {
    render(<ComposerSchemeHarness />);
    await user.click(screen.getByTestId('composer-attach'));
    await screen.findByTestId('workbench-image-picker');
    expect(screen.queryByTestId('workbench-context-ref-scheme')).toBeNull();
    expect(screen.queryByTestId('composer-menu-design-plan')).toBeNull();
    expect(screen.queryByTestId('workbench-context-history-source')).toBeNull();
    expect(screen.queryByTestId('workbench-context-find-scheme')).toBeNull();
  });

  it('单项回调缺失:该项禁用并给理由(I4),其余可用', async () => {
    const onOpenDesignSchemes = vi.fn();
    render(<ComposerSchemeHarness scheme={{ onOpenDesignSchemes }} />);
    await user.click(screen.getByTestId('composer-attach'));
    const picker = await screen.findByTestId('workbench-context-ref-scheme');
    expect(picker.getAttribute('aria-disabled')).toBe('true');
    expect(picker.getAttribute('title')).toBe('当前环境暂未接入该入口');
    expect(screen.getByTestId('composer-menu-design-plan').getAttribute('aria-disabled')).toBe(
      'true',
    );
    const find = screen.getByTestId('workbench-context-find-scheme');
    expect(find.getAttribute('aria-disabled')).not.toBe('true');
    await user.click(find);
    expect(onOpenDesignSchemes).toHaveBeenCalledTimes(1);
  });

  it('「设计方案」先退菜单再开选择器(不叠两层浮层)', async () => {
    const onOpenPicker = vi.fn();
    render(<ComposerSchemeHarness scheme={{ onOpenPicker }} />);
    await user.click(screen.getByTestId('composer-attach'));
    await user.click(await screen.findByTestId('workbench-context-ref-scheme'));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onOpenPicker).toHaveBeenCalledTimes(1);
  });
});

describe('Composer 方案附件(挂载与必需输入收集)', () => {
  it('三种模式芯片/占位语/提交文案(逐字承旧)', () => {
    const { unmount } = render(
      <ComposerSchemeHarness scheme={{ attachment: makeAttachment({ mode: 'formal' }) }} />,
    );
    expect(screen.getByTestId('scheme-run-attachment').getAttribute('data-mode')).toBe('formal');
    expect(screen.getByTestId('scheme-run-chip').textContent).toContain('水彩海报');
    expect(screen.getByTestId('scheme-run-chip').textContent).toContain('Musefold 创建 · 完整还原');
    expect(screen.getByTestId('scheme-run-mode-hint').textContent).toBe(
      '方案决定稳定的视觉方向，本次输入只影响这一次生成。',
    );
    expect(screen.getByTestId('composer-prompt').getAttribute('placeholder')).toBe(
      '补充本次要求（可选），方案会保持视觉方向…',
    );
    expect(screen.getByTestId('composer-submit').getAttribute('aria-label')).toBe('按方案生成');
    unmount();

    const { unmount: unmountTrial } = render(
      <ComposerSchemeHarness scheme={{ attachment: makeAttachment({ mode: 'trial' }) }} />,
    );
    expect(screen.getByTestId('scheme-run-chip').textContent).toContain('试运行 · 水彩海报');
    expect(screen.getByTestId('scheme-run-mode-hint').textContent).toBe(
      '本次输入只用于验证方案，不会修改方案本身。',
    );
    expect(screen.getByTestId('composer-prompt').getAttribute('placeholder')).toBe(
      '补充这次试运行的具体内容（可选）…',
    );
    expect(screen.getByTestId('composer-submit').getAttribute('aria-label')).toBe('试运行方案');
    unmountTrial();

    render(<ComposerSchemeHarness scheme={{ attachment: makeAttachment({ mode: 'modify' }) }} />);
    expect(screen.getByTestId('scheme-run-chip').textContent).toContain('修改方案 · 水彩海报');
    expect(screen.getByTestId('composer-prompt').getAttribute('placeholder')).toBe(
      '描述要修改的内容，例如：把默认比例改成 3:4…',
    );
    expect(screen.getByTestId('composer-submit').getAttribute('aria-label')).toBe('发送修改要求');
  });

  it('必需文本槽位未填:提交禁用;填后放行(空正文也可按方案生成)', async () => {
    render(
      <ComposerSchemeHarness
        scheme={{
          attachment: makeAttachment({
            inputs: [
              { id: 'subject', label: '主题', kind: 'text', required: true },
              { id: 'style', label: '风格', kind: 'text', required: false },
            ],
          }),
        }}
      />,
    );
    const submit = screen.getByTestId('composer-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    // 必填变量常驻,可选默认隐藏并经「添加可选输入」加入。
    expect(screen.getByTestId('scheme-run-variable-subject')).toBeTruthy();
    expect(screen.queryByTestId('scheme-run-variable-style')).toBeNull();
    await user.click(screen.getByTestId('scheme-run-variable-add'));
    await user.click(await screen.findByTestId('scheme-run-variable-add-style'));
    expect(screen.getByTestId('scheme-run-variable-style')).toBeTruthy();

    await user.type(screen.getByTestId('scheme-run-variable-subject'), '猫');
    expect((screen.getByTestId('composer-submit') as HTMLButtonElement).disabled).toBe(false);
  });

  it('必需图片槽位按就绪参考图计数放行', () => {
    render(
      <ComposerSchemeHarness
        scheme={{
          attachment: makeAttachment({
            inputs: [{ id: 'main', label: '主图', kind: 'image', required: true }],
          }),
        }}
      />,
    );
    const slot = screen.getByTestId('scheme-run-image-slot-main');
    expect(slot.getAttribute('data-filled')).toBe('false');
    expect((screen.getByTestId('composer-submit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('运行管线未接入:提交禁用且 title 给理由(不伪造方案运行)', () => {
    render(
      <ComposerSchemeHarness
        scheme={{
          attachment: makeAttachment(),
          submitDisabledReason: '当前环境暂未接入方案运行',
        }}
      />,
    );
    const submit = screen.getByTestId('composer-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(submit.getAttribute('title')).toBe('当前环境暂未接入方案运行');
  });

  it('芯片移除回调清空附件;Backspace 空文依次弹创建态再弹附件', async () => {
    render(
      <ComposerSchemeHarness
        scheme={{
          attachment: makeAttachment(),
          creation: { createKind: 'idea', source: null },
        }}
      />,
    );
    // 附件优先渲染(attachment 与 creation 互斥由屏幕层保证,这里验证 Backspace 顺序)。
    const prompt = screen.getByTestId('composer-prompt');
    fireEvent.keyDown(prompt, { key: 'Backspace' });
    expect(screen.queryByTestId('composer-scheme-creation')).toBeNull();
    expect(screen.getByTestId('scheme-run-attachment')).toBeTruthy();
    fireEvent.keyDown(prompt, { key: 'Backspace' });
    expect(screen.queryByTestId('scheme-run-attachment')).toBeNull();
  });
});

describe('Composer 方案创建态(design-plan,承旧 draftCommand)', () => {
  it('创建芯片 + 来源行 + 占位语 + 提交文案;退出钮清创建态', async () => {
    render(
      <ComposerSchemeHarness
        scheme={{
          creation: {
            createKind: 'prompt',
            source: { kind: 'prompt', promptId: 'p-1', title: '水彩猫' },
          },
        }}
      />,
    );
    expect(screen.getByTestId('composer-scheme-creation').textContent).toContain('生成设计方案');
    expect(screen.getByTestId('composer-scheme-creation-source').textContent).toBe('来源:水彩猫');
    expect(screen.getByTestId('composer-prompt').getAttribute('placeholder')).toBe(
      '描述你的方案想法，可附 GitHub Skill 地址…',
    );
    expect(screen.getByTestId('composer-submit').getAttribute('aria-label')).toBe('创建设计方案');

    await user.click(screen.getByTestId('composer-scheme-creation-remove'));
    expect(screen.queryByTestId('composer-scheme-creation')).toBeNull();
    expect(screen.getByTestId('composer-prompt').getAttribute('placeholder')).toBe(
      '描述你想生成的图片…',
    );
  });

  it('空正文禁提交(brief 必填);创建不强制 Provider(承旧 designPlanIntent 豁免)', () => {
    render(<ComposerSchemeHarness scheme={{ creation: { createKind: 'idea', source: null } }} />);
    expect((screen.getByTestId('composer-submit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('历史来源芯片计数;创建缝缺失禁用并解释', () => {
    render(
      <ComposerSchemeHarness
        initialPrompt="从这些内容创建一个可复用方案。"
        scheme={{
          creation: {
            createKind: 'history',
            source: {
              kind: 'history',
              selection: {
                items: [
                  { jobId: 'j1', assetUrl: 'media://a.png', prompt: '甲' },
                  { jobId: 'j2', assetUrl: 'media://b.png', prompt: null },
                ],
                note: '从这些内容创建一个可复用方案。',
              },
            },
          },
          submitDisabledReason: '当前环境暂未接入方案创建',
        }}
      />,
    );
    expect(screen.getByTestId('composer-scheme-creation-source').textContent).toBe(
      '来源:历史内容 2 项',
    );
    const submit = screen.getByTestId('composer-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(submit.getAttribute('title')).toBe('当前环境暂未接入方案创建');
  });
});
