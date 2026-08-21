import type { SkillRuntimeTraceItem } from "@musefold/desktop-contracts/skill-runtime";
import { MusefoldAssistantAvatar } from "../../../components/brand/MusefoldAssistantAvatar";
import { SkillRuntimeConversation } from "./SkillRuntimeAttachment";

export function PendingSkillConversation({
  prompt,
  trace,
}: {
  prompt: string;
  trace: SkillRuntimeTraceItem[];
}) {
  return (
    <article className="space-y-4" data-testid="skill-runtime-pending-turn">
      <div className="ml-auto max-w-[min(88%,460px)] rounded-2xl rounded-br-md bg-inset px-4 py-3 text-[13px] leading-relaxed text-primary">
        <p className="whitespace-pre-wrap break-words">{prompt}</p>
      </div>
      <div className="flex gap-3">
        <MusefoldAssistantAvatar data-testid="skill-runtime-assistant-avatar" />
        <div className="min-w-0 flex-1">
          <div className="mb-1 text-[11px] font-medium text-secondary">
            Musefold
          </div>
          <SkillRuntimeConversation trace={trace} />
        </div>
      </div>
    </article>
  );
}
