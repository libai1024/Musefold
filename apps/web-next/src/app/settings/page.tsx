'use client';

import { SettingsScreen } from '@musefold/features/settings';
import { useRouter } from 'next/navigation';

export default function SettingsPage() {
  const router = useRouter();
  return <SettingsScreen onOpenScreen={(id) => router.push(`/${id}`)} />;
}
