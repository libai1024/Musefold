import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workbench = readFileSync(
  'src/features/generation/workbench/GenerationWorkbench.tsx',
  'utf8',
);
const ratioPicker = readFileSync(
  'src/features/generation/components/RatioPicker.tsx',
  'utf8',
);
const skillRuntimeAttachment = readFileSync(
  'src/features/generation/workbench/SkillRuntimeAttachment.tsx',
  'utf8',
);

describe('workbench image and message interaction contract', () => {
  it('uses one image path for picker, paste and drag-drop staging', () => {
    expect(workbench).toContain('<Plus className="h-4 w-4" />');
    expect(workbench).toContain('data-testid="workbench-image-input"');
    expect(workbench).toContain('void stageImageFiles(files)');
    expect(workbench).toContain('onPaste={(event) =>');
    expect(workbench).toContain('onDrop={(event) =>');
    expect(workbench).toContain('await api.image.stageLocal');
    expect(workbench).toContain('data-testid="workbench-image-drop-overlay"');
  });

  it('keeps referenced images inspectable and user edits explicit', () => {
    expect(workbench).toContain('data-testid="workbench-draft-image-preview"');
    expect(workbench).toContain('data-testid="refinement-context-image-preview"');
    expect(workbench).toContain('data-testid="generation-user-message-actions"');
    expect(workbench).toContain('editTurn(turn.id)');
    expect(workbench).not.toContain('editTurn(turn.id);\n    handleSubmit');
  });

  it('keeps the refinement target above the composer and the surface minimal', () => {
    expect(workbench.indexOf('<RefinementTargetReference')).toBeLessThan(
      workbench.indexOf('data-testid="workbench-composer-surface"'),
    );
    expect(workbench.indexOf('<DraftImagesPreview')).toBeLessThan(
      workbench.indexOf('data-testid="workbench-composer-surface"'),
    );
    expect(workbench).toContain('data-position="above-composer"');
    expect(workbench).toContain('data-testid="refinement-target-label">微调目标');
    expect(workbench).not.toContain('data-testid="refinement-suggestion"');
    expect(workbench).not.toContain('data-testid="refinement-inherited-settings"');
  });

  it('opens a full-width grouped add panel above the composer', () => {
    expect(workbench).toContain('data-testid="workbench-context-menu"');
    expect(workbench).toContain('absolute inset-x-0 bottom-[calc(100%+10px)]');
    expect(workbench).toContain('data-testid="workbench-context-add-image"');
    expect(workbench).toContain('上传、粘贴或拖入');
    expect(workbench).toContain("document.addEventListener('pointerdown', onPointerDown)");
    expect(workbench).toContain('await api.system.readClipboardText()');
    expect(workbench).not.toContain('await navigator.clipboard.readText()');
  });

  it('shows all ratios as compact visual cards and keeps status out of the result header', () => {
    expect(ratioPicker).toContain("variant={variant === 'compact' ? 'compact-cards' : 'cards'}");
    expect(ratioPicker).toContain("columns={variant === 'compact' ? 'three' : menuColumns}");
    expect(workbench).not.toContain('data-testid="generation-turn-status-dot"');
    expect(workbench).not.toContain('data-testid="generation-turn-kind"');
  });

  it('supports long-press selection and batch saving for multi-image results', () => {
    expect(workbench).toContain('window.setTimeout(() =>');
    expect(workbench).toContain('onEnterSelection();');
    expect(workbench).toContain('data-testid="generation-selection-toolbar"');
    expect(workbench).toContain('data-testid="generation-batch-download"');
    expect(workbench).toContain('api.system.saveImages(paths)');
    expect(workbench).toContain('data-testid="result-set-refinement-target"');
    expect(workbench).toContain('animateDeselection(releasedIds)');
    expect(workbench).toContain('animate-selection-release');
  });

  it('keeps image refinement actions available for Doubao results', () => {
    expect(workbench).toContain('showRefineAction={turn.results.length > 1}');
    expect(workbench).toContain('refinementEnabled');
    expect(workbench).toContain('{turn.results.length === 1 && (');
    expect(workbench).not.toContain('refinementEnabled={!isDoubaoTurn}');
    expect(workbench).not.toContain('豆包网页版暂不支持图片微调');
  });

  it('renders Skill execution as conversation content, never as a Composer trace', () => {
    expect(workbench).toContain('<SkillRuntimeConversation');
    expect(workbench).toContain('data-testid="generation-skill-reference"');
    expect(workbench).toContain('data-testid="skill-runtime-pending-turn"');
    expect(workbench).not.toContain('<SkillRuntimeTrace />');
    expect(skillRuntimeAttachment).toContain('data-testid="skill-runtime-conversation"');
    expect(skillRuntimeAttachment).toContain('data-placement="conversation"');
    expect(skillRuntimeAttachment).not.toContain('data-testid="skill-runtime-trace"');
    expect(skillRuntimeAttachment).toContain("status === 'executing' || status === 'complete'");
  });

  it('makes Doubao pasted-Skill forwarding explicit and hides Agent-only actions', () => {
    expect(workbench).toContain('data-testid="workbench-context-paste-skill"');
    expect(workbench).toContain("doubaoImageMode ? '粘贴后直传豆包' : '读取设计能力'");
    expect(workbench).toContain('{!doubaoImageMode && (');
    expect(workbench).toContain("execution.mode === 'direct-forward'");
    expect(workbench).toContain("'已将 Skill 转发给豆包'");
    expect(workbench).toContain("'GitHub Skill · 直传豆包'");
    expect(skillRuntimeAttachment).toContain('豆包直传');
    expect(skillRuntimeAttachment).toContain('不调用 Agent');
  });
});
