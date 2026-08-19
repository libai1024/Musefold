import type { ReactNode } from "react";

export interface WorkbenchAssistantFrameProps {
  avatar: ReactNode;
  header?: ReactNode;
  children: ReactNode;
  className?: string;
  avatarClassName?: string;
  bodyClassName?: string;
  testId?: string;
}

/** Shared assistant/result column. Hosts own the avatar and header content. */
export function WorkbenchAssistantFrame({
  avatar,
  header,
  children,
  className,
  avatarClassName,
  bodyClassName,
  testId,
}: WorkbenchAssistantFrameProps) {
  return (
    <div
      className={["mf-workbench-assistant-frame", className]
        .filter(Boolean)
        .join(" ")}
      data-testid={testId}
    >
      <div
        className={["mf-workbench-assistant-avatar", avatarClassName]
          .filter(Boolean)
          .join(" ")}
      >
        {avatar}
      </div>
      <div
        className={["mf-workbench-assistant-body", bodyClassName]
          .filter(Boolean)
          .join(" ")}
      >
        {header}
        {children}
      </div>
    </div>
  );
}
