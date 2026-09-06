'use client';

import { PromptLibraryScreen } from '@musefold/features/prompts';
import { useActiveSession } from '@musefold/features/workbench';
import { useRouter } from 'next/navigation';
import { createWorkbenchHref } from '../../lib/workbench-session-url';

export default function PromptsPage() {
  const router = useRouter();
  return (
    <PromptLibraryScreen
      onOpenWorkbench={() => {
        const { activeSessionId, draftSession } = useActiveSession.getState();
        router.push(createWorkbenchHref(draftSession ? null : activeSessionId));
      }}
      onOpenHistory={() => router.push('/history')}
    />
  );
}
