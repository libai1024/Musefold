export interface ThirdPartyPackage {
  name: string;
  license: string;
}

/**
 * Direct runtime dependencies shipped by Musefold.
 * 与 `apps/desktop/package.json` 的 dependencies 逐条对齐（workspace 包除外，
 * `@radix-ui/*` 合并为一条），由 `tests/repo/third-party-notices.test.ts` 强制。
 */
export const THIRD_PARTY_PACKAGES: ThirdPartyPackage[] = [
  { name: '@ai-sdk/openai-compatible', license: 'Apache-2.0' },
  { name: '@dnd-kit/core', license: 'MIT' },
  { name: '@gsap/react', license: "Standard 'no charge' license (gsap.com/standard-license)" },
  { name: '@radix-ui/react-*', license: 'MIT' },
  { name: '@tanstack/react-query', license: 'MIT' },
  { name: '@tanstack/react-virtual', license: 'MIT' },
  { name: 'ai', license: 'Apache-2.0' },
  { name: 'archiver', license: 'MIT' },
  { name: 'archiver-utils', license: 'MIT' },
  { name: 'better-sqlite3', license: 'MIT' },
  { name: 'class-variance-authority', license: 'Apache-2.0' },
  { name: 'clsx', license: 'MIT' },
  { name: 'diff-match-patch', license: 'Apache-2.0' },
  { name: 'electron-store', license: 'MIT' },
  { name: 'electron-updater', license: 'MIT' },
  { name: 'fuse.js', license: 'Apache-2.0' },
  { name: 'gpt-tokenizer', license: 'MIT' },
  { name: 'gsap', license: "Standard 'no charge' license (gsap.com/standard-license)" },
  { name: 'immer', license: 'MIT' },
  { name: 'lucide-react', license: 'ISC' },
  { name: 'openai', license: 'Apache-2.0' },
  { name: 'react', license: 'MIT' },
  { name: 'react-arborist', license: 'MIT' },
  { name: 'react-dom', license: 'MIT' },
  { name: 'tailwind-merge', license: 'MIT' },
  { name: 'ulid', license: 'MIT' },
  { name: 'yaml', license: 'ISC' },
  { name: 'yauzl', license: 'MIT' },
  { name: 'zod', license: 'MIT' },
  { name: 'zustand', license: 'MIT' },
];
