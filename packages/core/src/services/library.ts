// LibraryService（V04-CORE-04）：提示词库读 + 低危写（save_prompt / 素笺回流）。
// v1 面向暴露矩阵：search 🟢 / get 🟢 / create 🟡；stats 供 status 汇总。

import type { ListPromptsQuery, PromptStats } from '@shared/types/ipc';
import type { NewPrompt, Prompt } from '@shared/types/models';
import { promptsRepo } from '../db/repositories/prompts';

export interface LibraryService {
  search(query?: ListPromptsQuery): Prompt[];
  get(id: string): Prompt | null;
  create(input: NewPrompt): Prompt;
  stats(): PromptStats;
}

export function createLibraryService(repo: typeof promptsRepo = promptsRepo): LibraryService {
  return {
    search: (query = {}) => repo.list(query),
    get: (id) => repo.get(id),
    create: (input) => repo.create(input),
    stats: () => repo.stats(),
  };
}
