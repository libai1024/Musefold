export interface ThirdPartyPackage {
  name: string;
  license: string;
}

/** Direct runtime dependencies shipped by Musefold (package-lock, 2026-08-09). */
export const THIRD_PARTY_PACKAGES: ThirdPartyPackage[] = [
  { name: '@ai-sdk/openai-compatible', license: 'Apache-2.0' },
  { name: '@dnd-kit/core', license: 'MIT' },
  { name: '@radix-ui/react-*', license: 'MIT' },
  { name: '@tanstack/react-virtual', license: 'MIT' },
  { name: 'archiver', license: 'MIT' },
  { name: 'ai', license: 'Apache-2.0' },
  { name: 'better-sqlite3', license: 'MIT' },
  { name: 'class-variance-authority', license: 'Apache-2.0' },
  { name: 'clsx', license: 'MIT' },
  { name: 'diff-match-patch', license: 'Apache-2.0' },
  { name: 'electron-store', license: 'MIT' },
  { name: 'fuse.js', license: 'Apache-2.0' },
  { name: 'gpt-tokenizer', license: 'MIT' },
  { name: 'immer', license: 'MIT' },
  { name: 'lucide-react', license: 'ISC' },
  { name: 'openai', license: 'Apache-2.0' },
  { name: 'react', license: 'MIT' },
  { name: 'react-arborist', license: 'MIT' },
  { name: 'react-dom', license: 'MIT' },
  { name: 'react-hook-form', license: 'MIT' },
  { name: 'tailwind-merge', license: 'MIT' },
  { name: 'ulid', license: 'MIT' },
  { name: 'yauzl', license: 'MIT' },
  { name: 'zod', license: 'MIT' },
  { name: 'zustand', license: 'MIT' },
];
