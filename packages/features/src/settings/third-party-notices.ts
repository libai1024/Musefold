import type { ThirdPartyNotice } from '@musefold/contracts';

/**
 * 第三方开源许可清单(许可合规要求可达,07-settings-07 §2.3)。
 *
 * 纯静态数据,双端同一份 —— 所以它住 features 而不是走 IPC:
 * 没有任何主进程状态参与,Web 宿主也必须能展示同一份声明。
 * 形状事实源是 contracts 的 `thirdPartyNoticeSchema`(就地测试逐条校验)。
 *
 * 维护口径:与两个宿主 `package.json` 的 dependencies 逐条对齐
 * (workspace 包除外;`@radix-ui/*` 合并为一条),新增运行时依赖时同步本表。
 */
export const THIRD_PARTY_NOTICES: readonly ThirdPartyNotice[] = [
  { name: '@ai-sdk/openai-compatible', license: 'Apache-2.0' },
  { name: '@dnd-kit/core', license: 'MIT' },
  { name: '@gsap/react', license: 'GSAP Standard License' },
  { name: '@radix-ui/*', license: 'MIT' },
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
  { name: 'gsap', license: 'GSAP Standard License' },
  { name: 'immer', license: 'MIT' },
  { name: 'lucide-react', license: 'ISC' },
  { name: 'next', license: 'MIT' },
  { name: 'next-themes', license: 'MIT' },
  { name: 'openai', license: 'Apache-2.0' },
  { name: 'react', license: 'MIT' },
  { name: 'react-arborist', license: 'MIT' },
  { name: 'react-dom', license: 'MIT' },
  { name: 'sonner', license: 'MIT' },
  { name: 'tailwind-merge', license: 'MIT' },
  { name: 'ulid', license: 'MIT' },
  { name: 'yaml', license: 'ISC' },
  { name: 'yauzl', license: 'MIT' },
  { name: 'zod', license: 'MIT' },
  { name: 'zustand', license: 'MIT' },
];
