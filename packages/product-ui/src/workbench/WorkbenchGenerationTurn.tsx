import type { HTMLAttributes, ReactNode } from "react";
import { WorkbenchAssistantFrame } from "./WorkbenchAssistantFrame";
import { WorkbenchResultGrid } from "./WorkbenchResultGrid";
import { WorkbenchTurnFrame } from "./WorkbenchTurnFrame";

export interface WorkbenchGenerationTurnProps {
  turnId: string;
  status?: string;
  userTestId?: string;
  userProps?: Omit<HTMLAttributes<HTMLDivElement>, "children" | "className">;
  userMessage: ReactNode;
  avatar: ReactNode;
  header?: ReactNode;
  assistantTestId?: string;
  preface?: ReactNode;
  results?: ReactNode;
  resultCount?: number;
  resultAspectRatio?: string;
  resultProvider?: string;
  actions?: ReactNode;
  appendix?: ReactNode;
}

/** Shared generation turn assembly. Hosts inject avatar, message, results, and host-only slots. */
export function WorkbenchGenerationTurn({
  turnId,
  status,
  userTestId = "generation-user-message",
  userProps,
  userMessage,
  avatar,
  header,
  assistantTestId = "generation-result-group",
  preface,
  results,
  resultCount = 0,
  resultAspectRatio = "1:1",
  resultProvider,
  actions,
  appendix,
}: WorkbenchGenerationTurnProps) {
  return (
    <WorkbenchTurnFrame
      testId={`generation-turn-${turnId}`}
      status={status}
      userTestId={userTestId}
      userProps={userProps}
      userMessage={userMessage}
    >
      <WorkbenchAssistantFrame testId={assistantTestId} avatar={avatar} header={header}>
        {preface}
        {resultCount > 0 && results ? (
          <WorkbenchResultGrid
            count={resultCount}
            aspectRatio={resultAspectRatio}
            provider={resultProvider}
          >
            {results}
          </WorkbenchResultGrid>
        ) : null}
        {actions}
        {appendix}
      </WorkbenchAssistantFrame>
    </WorkbenchTurnFrame>
  );
}
