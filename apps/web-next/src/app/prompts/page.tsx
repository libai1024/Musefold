'use client';

import { PromptLibraryScreen } from '@musefold/features/prompts';
import { useRouter } from 'next/navigation';

export default function PromptsPage() {
  const router = useRouter();
  return <PromptLibraryScreen onOpenWorkbench={() => router.push('/workbench')} />;
}
