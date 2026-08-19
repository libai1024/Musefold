import type { HTMLAttributes, ReactNode } from "react";

export interface WorkbenchTurnFrameProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children" | "className"
> {
  userMessage: ReactNode;
  children: ReactNode;
  className?: string;
  userClassName?: string;
  testId?: string;
  userTestId?: string;
  status?: string;
  userProps?: Omit<HTMLAttributes<HTMLDivElement>, "children" | "className">;
}

/** Shared conversation turn. Hosts provide message content and assistant output. */
export function WorkbenchTurnFrame({
  userMessage,
  children,
  className,
  userClassName,
  testId,
  userTestId,
  status,
  userProps,
  ...articleAttributes
}: WorkbenchTurnFrameProps) {
  return (
    <article
      {...articleAttributes}
      className={["mf-workbench-turn", className].filter(Boolean).join(" ")}
      data-testid={testId}
      data-status={status}
    >
      <div
        {...userProps}
        className={["mf-workbench-turn-user", userClassName]
          .filter(Boolean)
          .join(" ")}
        data-user-message
        data-testid={userTestId}
      >
        {userMessage}
      </div>
      {children}
    </article>
  );
}
