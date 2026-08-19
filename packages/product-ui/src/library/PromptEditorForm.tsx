import { ChevronDown, Pin, X } from "@musefold/ui/icons";
import { Button, IconButton, Input, Textarea } from "@musefold/ui";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type { PromptEditorDraft } from "../models";

const emptyDraft: PromptEditorDraft = {
  title: "",
  description: "",
  content: "",
  negative: "",
  isPinned: false,
};

type PromptEditorTestIds = Partial<{
  title: string;
  description: string;
  content: string;
  negative: string;
  negativeToggle: string;
  cancel: string;
  submit: string;
  discard: string;
}>;

export interface PromptEditorFormProps {
  heading: string;
  subtitle?: string;
  initial?: PromptEditorDraft;
  busy?: boolean;
  error?: string | null;
  notice?: ReactNode;
  submitLabel?: string;
  layout?: "page" | "dialog";
  negativeCollapsible?: boolean;
  showPin?: boolean;
  titleMaxLength?: number;
  contentMaxLength?: number;
  negativeMaxLength?: number;
  titlePlaceholder?: string;
  descriptionPlaceholder?: string;
  contentPlaceholder?: string;
  negativePlaceholder?: string;
  testIds?: PromptEditorTestIds;
  onCancel: () => void;
  onSubmit: (draft: PromptEditorDraft) => void | Promise<void>;
}

export function PromptEditorForm({
  heading,
  subtitle = "标题与正文必填，修改会同步到个人提示词库。",
  initial = emptyDraft,
  busy = false,
  error,
  notice,
  submitLabel = "保存提示词",
  layout = "page",
  negativeCollapsible = true,
  showPin = true,
  titleMaxLength = 120,
  contentMaxLength = 12_000,
  negativeMaxLength = 4_000,
  titlePlaceholder = "给这段提示词起一个能认出来的名字",
  descriptionPlaceholder = "补充这段提示词的用途",
  contentPlaceholder = "生成图像时实际发送的提示词内容",
  negativePlaceholder = "不希望出现的元素",
  testIds,
  onCancel,
  onSubmit,
}: PromptEditorFormProps) {
  const [draft, setDraft] = useState<PromptEditorDraft>(initial);
  const [touched, setTouched] = useState<{
    title?: boolean;
    content?: boolean;
  }>({});
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [negativeOpen, setNegativeOpen] = useState(
    !negativeCollapsible || Boolean(initial.negative),
  );
  const initialRef = useRef(initial);
  const formRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setDraft(initial);
    initialRef.current = initial;
    setTouched({});
    setConfirmDiscard(false);
    setNegativeOpen(!negativeCollapsible || Boolean(initial.negative));
  }, [initial, negativeCollapsible]);

  const errors = useMemo(() => {
    const next: { title?: string; content?: string } = {};
    if (!draft.title.trim()) next.title = "标题必填";
    else if (draft.title.length > titleMaxLength) {
      next.title = `标题不超过 ${titleMaxLength} 字`;
    }
    if (!draft.content.trim()) next.content = "正文必填";
    return next;
  }, [draft.content, draft.title, titleMaxLength]);

  const valid = Object.keys(errors).length === 0;
  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(initialRef.current),
    [draft],
  );

  const submit = () => {
    setTouched({ title: true, content: true });
    if (!valid || busy) return;
    void onSubmit({
      ...draft,
      title: draft.title.trim(),
      description: draft.description.trim(),
      content: draft.content.trim(),
      negative: draft.negative.trim(),
    });
  };

  const cancel = () => {
    if (dirty && !confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    onCancel();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!formRef.current?.contains(event.target as Node)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        submit();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const ids = {
    title: testIds?.title ?? "prompt-editor-title",
    description: testIds?.description ?? "prompt-editor-description",
    content: testIds?.content ?? "prompt-editor-content",
    negative: testIds?.negative ?? "prompt-editor-negative",
    negativeToggle: testIds?.negativeToggle ?? "prompt-editor-negative-toggle",
    cancel: testIds?.cancel ?? "prompt-editor-cancel",
    submit: testIds?.submit ?? "prompt-editor-submit",
    discard: testIds?.discard ?? "prompt-editor-discard",
  };

  return (
    <section
      ref={formRef}
      className="mf-prompt-editor"
      data-layout={layout}
      data-testid="prompt-editor"
    >
      <header>
        <div>
          <h1>{heading}</h1>
          <p>{subtitle}</p>
        </div>
        <IconButton
          className="mf-icon-button"
          label="关闭"
          onClick={cancel}
          disabled={busy}
        >
          <X aria-hidden="true" />
        </IconButton>
      </header>
      {notice}
      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          submit();
        }}
      >
        <EditorField
          label="标题"
          required
          error={touched.title ? errors.title : undefined}
        >
          <Input
            value={draft.title}
            maxLength={titleMaxLength}
            autoFocus
            placeholder={titlePlaceholder}
            aria-invalid={Boolean(touched.title && errors.title)}
            data-testid={ids.title}
            onChange={(event) =>
              setDraft((current) => ({ ...current, title: event.target.value }))
            }
            onBlur={() => setTouched((current) => ({ ...current, title: true }))}
          />
        </EditorField>

        <EditorField label="描述">
          <Input
            value={draft.description}
            maxLength={500}
            placeholder={descriptionPlaceholder}
            data-testid={ids.description}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                description: event.target.value,
              }))
            }
          />
        </EditorField>

        <EditorField
          label="正文"
          required
          error={touched.content ? errors.content : undefined}
        >
          <Textarea
            value={draft.content}
            maxLength={contentMaxLength}
            rows={10}
            placeholder={contentPlaceholder}
            aria-invalid={Boolean(touched.content && errors.content)}
            data-testid={ids.content}
            onChange={(event) =>
              setDraft((current) => ({ ...current, content: event.target.value }))
            }
            onBlur={() => setTouched((current) => ({ ...current, content: true }))}
          />
        </EditorField>

        {negativeCollapsible ? (
          <div className="mf-prompt-editor-negative">
            <Button
              variant="ghost"
              type="button"
              className="mf-prompt-editor-negative-toggle"
              aria-expanded={negativeOpen}
              data-testid={ids.negativeToggle}
              onClick={() => setNegativeOpen((open) => !open)}
            >
              <ChevronDown aria-hidden="true" data-open={negativeOpen} />
              <span>负面提示词</span>
              <small>可选</small>
            </Button>
            {negativeOpen && (
              <Textarea
                value={draft.negative}
                maxLength={negativeMaxLength}
                rows={4}
                placeholder={negativePlaceholder}
                data-testid={ids.negative}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    negative: event.target.value,
                  }))
                }
              />
            )}
          </div>
        ) : (
          <EditorField label="负面提示词">
            <Textarea
              value={draft.negative}
              maxLength={negativeMaxLength}
              rows={4}
              placeholder={negativePlaceholder}
              data-testid={ids.negative}
              onChange={(event) =>
                setDraft((current) => ({ ...current, negative: event.target.value }))
              }
            />
          </EditorField>
        )}

        {showPin && (
          <label className="mf-editor-checkbox">
            <input
              type="checkbox"
              checked={draft.isPinned}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  isPinned: event.target.checked,
                }))
              }
            />
            <Pin aria-hidden="true" />
            <span>置顶</span>
          </label>
        )}

        {error && (
          <p className="mf-inline-error" role="alert">
            {error}
          </p>
        )}

        {confirmDiscard ? (
          <div className="mf-prompt-editor-discard" role="alert">
            <span>有未保存的改动，确认放弃？</span>
            <div>
              <Button
                variant="secondary"
                className="mf-secondary-button"
                onClick={() => setConfirmDiscard(false)}
              >
                继续编辑
              </Button>
              <Button
                variant="secondary"
                className="mf-secondary-button"
                data-testid={ids.discard}
                onClick={onCancel}
              >
                放弃改动
              </Button>
            </div>
          </div>
        ) : (
          <footer>
            <Button
              variant="secondary"
              className="mf-secondary-button"
              disabled={busy}
              data-testid={ids.cancel}
              onClick={cancel}
            >
              取消
            </Button>
            <Button
              variant="primary"
              className="mf-primary-button"
              type="submit"
              disabled={busy || !valid}
              data-testid={ids.submit}
              busy={busy}
              busyLabel="保存中"
            >
              {submitLabel}
            </Button>
          </footer>
        )}
      </form>
    </section>
  );
}

function EditorField({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="mf-prompt-editor-field">
      <span>
        {label}
        {required && <small>必填</small>}
        {error && <em role="alert">{error}</em>}
      </span>
      {children}
    </label>
  );
}
