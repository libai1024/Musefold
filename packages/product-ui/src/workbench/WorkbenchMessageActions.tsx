import { Button } from "@musefold/ui";
import { Copy, Pencil } from "@musefold/ui/icons";

export interface WorkbenchMessageActionsProps {
  onCopy: () => void | Promise<void>;
  onEdit: () => void;
  editDisabled?: boolean;
  copyTestId?: string;
  editTestId?: string;
}

/** Shared actions shown when a user activates a workbench message. */
export function WorkbenchMessageActions({
  onCopy,
  onEdit,
  editDisabled = false,
  copyTestId = "generation-user-message-copy",
  editTestId = "generation-user-message-edit",
}: WorkbenchMessageActionsProps) {
  return (
    <>
      <Button
        unstyled
        className="mf-workbench-message-action"
        onClick={() => {
          void onCopy();
        }}
        data-testid={copyTestId}
        icon={<Copy aria-hidden="true" />}
      >
        复制
      </Button>
      <Button
        unstyled
        className="mf-workbench-message-action"
        onClick={onEdit}
        disabled={editDisabled}
        data-testid={editTestId}
        icon={<Pencil aria-hidden="true" />}
      >
        编辑
      </Button>
    </>
  );
}
