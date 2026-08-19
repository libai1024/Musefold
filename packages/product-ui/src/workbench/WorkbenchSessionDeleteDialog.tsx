import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@musefold/ui";

export interface WorkbenchSessionDeleteDialogProps {
  open: boolean;
  title: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  busy?: boolean;
}

/** Shared destructive-action confirmation for conversation deletion. */
export function WorkbenchSessionDeleteDialog({
  open,
  title,
  onOpenChange,
  onConfirm,
  busy = false,
}: WorkbenchSessionDeleteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>删除对话？</DialogTitle>
          <DialogDescription>
            「{title}」将从对话列表移除。已经生成的图片仍保留在生成历史中。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            取消
          </Button>
          <Button
            variant="danger"
            onClick={onConfirm}
            disabled={busy || !title}
            busy={busy}
            busyLabel="删除中"
          >
            删除对话
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
