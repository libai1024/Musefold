import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workbench = readFileSync(
  "apps/desktop/src/features/generation/workbench/GenerationWorkbench.tsx",
  "utf8",
);
const ratioPicker = readFileSync(
  "apps/desktop/src/features/generation/components/RatioPicker.tsx",
  "utf8",
);
const sharedContextMenu = readFileSync(
  "packages/product-ui/src/workbench/WorkbenchContextMenu.tsx",
  "utf8",
);
const sharedUserMessage = readFileSync(
  "packages/product-ui/src/workbench/WorkbenchUserMessage.tsx",
  "utf8",
);
const sharedRatioPicker = readFileSync(
  "packages/product-ui/src/workbench/WorkbenchRatioPicker.tsx",
  "utf8",
);
const skillRuntimeAttachment = readFileSync(
  "apps/desktop/src/features/generation/workbench/SkillRuntimeAttachment.tsx",
  "utf8",
);

describe("workbench image and message interaction contract", () => {
  it("uses one image path for picker, paste and drag-drop staging", () => {
    expect(workbench).toContain("<WorkbenchContextMenu");
    expect(sharedContextMenu).toContain('<Plus aria-hidden="true" />');
    expect(workbench).toContain('data-testid="workbench-image-input"');
    expect(workbench).toContain("void stageImageFiles(files)");
    expect(workbench).toContain("onPaste={(event) =>");
    expect(workbench).toContain("onDrop={(event) =>");
    expect(workbench).toContain("await api.image.stageLocal");
    expect(workbench).toContain('data-testid="workbench-image-drop-overlay"');
  });

  it("keeps referenced images inspectable and user edits explicit", () => {
    expect(workbench).toContain('data-testid="workbench-draft-image-preview"');
    expect(workbench).toContain(
      'data-testid="refinement-context-image-preview"',
    );
    expect(sharedUserMessage).toContain(
      'data-testid="generation-user-message-actions"',
    );
    expect(workbench).toContain("editTurn(turn.id)");
    expect(workbench).not.toContain("editTurn(turn.id);\n    handleSubmit");
  });

  it("keeps the refinement target above the composer and the surface minimal", () => {
    const attachmentSlot = workbench.indexOf("attachments={");
    const composerSurface = workbench.indexOf(
      "surfaceRef={composerSurfaceRef}",
    );
    expect(attachmentSlot).toBeGreaterThan(-1);
    expect(attachmentSlot).toBeLessThan(composerSurface);
    expect(workbench.indexOf("<RefinementTargetReference")).toBeGreaterThan(
      attachmentSlot,
    );
    expect(workbench.indexOf("<DraftImagesPreview")).toBeGreaterThan(
      attachmentSlot,
    );
    expect(workbench).toContain('data-position="above-composer"');
    expect(workbench).toContain('data-testid="refinement-target-label"');
    expect(workbench).toContain("微调目标");
    expect(workbench).not.toContain('data-testid="refinement-suggestion"');
    expect(workbench).not.toContain(
      'data-testid="refinement-inherited-settings"',
    );
  });

  it("opens a full-width grouped add panel above the composer", () => {
    expect(sharedContextMenu).toContain('data-testid="workbench-context-menu"');
    expect(sharedContextMenu).toContain('role="menu"');
    expect(workbench).toContain('testId: "workbench-context-add-image"');
    expect(workbench).toContain("上传、粘贴或拖入");
    expect(sharedContextMenu).toContain(
      'document.addEventListener("pointerdown", onPointerDown)',
    );
    expect(workbench).toContain("await api.system.readClipboardText()");
    expect(workbench).not.toContain("await navigator.clipboard.readText()");
  });

  it("shows all ratios as compact visual cards and keeps status out of the result header", () => {
    expect(ratioPicker).toContain(
      "variant={variant === 'compact' ? 'compact-cards' : 'cards'}",
    );
    expect(ratioPicker).toContain(
      "columns={variant === 'compact' ? 'three' : menuColumns}",
    );
    expect(workbench).toContain("<WorkbenchRatioPicker");
    expect(sharedRatioPicker).toContain("data-ratio-id={option.id}");
    expect(workbench).not.toContain('data-testid="generation-turn-status-dot"');
    expect(workbench).not.toContain('data-testid="generation-turn-kind"');
  });

  it("supports long-press selection and batch saving for multi-image results", () => {
    expect(workbench).toContain("window.setTimeout(() =>");
    expect(workbench).toContain("onEnterSelection();");
    expect(workbench).toContain('data-testid="generation-selection-toolbar"');
    expect(workbench).toContain('data-testid="generation-batch-download"');
    expect(workbench).toContain("api.system.saveImages(paths)");
    expect(workbench).toContain('data-testid="result-set-refinement-target"');
    expect(workbench).toContain("animateDeselection(releasedIds)");
    expect(workbench).toContain("deselecting={deselecting}");
  });

  it("keeps image refinement actions available for Doubao results", () => {
    expect(workbench).toContain("showRefineAction={turn.results.length > 1}");
    expect(workbench).toContain("refinementEnabled");
    expect(workbench).toContain("{successful.length > 0 && turn.results.length === 1 ? (");
    expect(workbench).not.toContain("refinementEnabled={!isDoubaoTurn}");
    expect(workbench).not.toContain("豆包网页版暂不支持图片微调");
  });

  it("renders Skill execution as conversation content, never as a Composer trace", () => {
    expect(workbench).toContain("<SkillRuntimeConversation");
    expect(workbench).toContain('data-testid="generation-skill-reference"');
    expect(workbench).toContain('data-testid="skill-runtime-pending-turn"');
    expect(workbench).not.toContain("<SkillRuntimeTrace />");
    expect(skillRuntimeAttachment).toContain(
      'data-testid="skill-runtime-conversation"',
    );
    expect(skillRuntimeAttachment).toContain('data-placement="conversation"');
    expect(skillRuntimeAttachment).not.toContain(
      'data-testid="skill-runtime-trace"',
    );
    expect(skillRuntimeAttachment).toContain(
      "status === 'executing' || status === 'complete'",
    );
  });

  it("makes Doubao pasted-Skill forwarding explicit and hides Agent-only actions", () => {
    expect(workbench).toContain('testId: "workbench-context-paste-skill"');
    expect(workbench).toContain(
      'doubaoImageMode ? "粘贴后直传豆包" : "读取设计能力"',
    );
    expect(workbench).toContain("...(!doubaoImageMode");
    expect(workbench).toContain('execution.mode === "direct-forward"');
    expect(workbench).toContain("已将 Skill 转发给豆包");
    expect(workbench).toContain("GitHub Skill · 直传豆包");
    expect(skillRuntimeAttachment).toContain("豆包直传");
    expect(skillRuntimeAttachment).toContain("不调用 Agent");
  });
});
