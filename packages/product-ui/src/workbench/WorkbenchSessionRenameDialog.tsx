import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@musefold/ui";

export interface WorkbenchSessionRenameDialogProps {
  open: boolean;
  title: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (title: string) => void | Promise<void>;
  busy?: boolean;
}

/** Shared conversation rename dialog used by every host surface. */
export function WorkbenchSessionRenameDialog({
  open,
  title,
  onOpenChange,
  onConfirm,
  busy = false,
}: WorkbenchSessionRenameDialogProps) {
  const [value, setValue] = useState("");

  useEffect(() => {
    if (open) setValue(title ?? "");
  }, [open, title]);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = value.trim();
    if (!next) return;
    void onConfirm(next);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>重命名对话</DialogTitle>
          <DialogDescription>为当前对话设置一个便于识别的标题。</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <DialogBody>
            <Input
              autoFocus
              value={value}
              onChange={(event) => setValue(event.target.value)}
              maxLength={80}
              aria-label="对话标题"
            />
          </DialogBody>
          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              取消
            </Button>
            <Button
              type="submit"
              disabled={busy || !value.trim()}
              busy={busy}
              busyLabel="保存中"
            >
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
