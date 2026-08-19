import { Search, X } from "@musefold/ui/icons";
import { IconButton, Input } from "@musefold/ui";

export interface PromptSearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function PromptSearchField({
  value,
  onChange,
  placeholder = "搜索标题或正文",
}: PromptSearchFieldProps) {
  return (
    <label className="mf-prompt-search">
      <Search aria-hidden="true" />
      <span className="mf-sr-only">搜索提示词</span>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="搜索提示词"
        placeholder={placeholder}
        data-testid="library-search"
      />
      {value && (
        <IconButton
          className="mf-prompt-search-clear"
          onClick={() => onChange("")}
          label="清空搜索"
          data-testid="library-search-clear"
        >
          <X aria-hidden="true" />
        </IconButton>
      )}
    </label>
  );
}
