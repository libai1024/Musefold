import type { HTMLAttributes } from "react";

export interface WorkbenchAssistantAvatarProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  imageUrl: string;
  label?: string;
}

/** Shared brand avatar used by the common workbench result column. */
export function WorkbenchAssistantAvatar({
  imageUrl,
  label = "Musefold AI",
  className,
  ...props
}: WorkbenchAssistantAvatarProps) {
  return (
    <div
      {...props}
      role="img"
      aria-label={label}
      className={["mf-workbench-assistant-avatar-image", className]
        .filter(Boolean)
        .join(" ")}
    >
      <img
        src={imageUrl}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
    </div>
  );
}
