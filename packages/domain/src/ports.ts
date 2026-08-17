import type {
  NewPromptDocument,
  PromptDocument,
  PromptListQuery,
  PromptPage,
  PromptUseInput,
  PromptUseResult,
  UpdatePromptDocument,
} from '@musefold/contracts';

export interface PromptRepository {
  list(query: PromptListQuery): Promise<PromptPage>;
  get(id: string): Promise<PromptDocument | null>;
  create(input: NewPromptDocument): Promise<PromptDocument>;
  update(id: string, patch: UpdatePromptDocument): Promise<PromptDocument>;
  remove(id: string, expectedVersion: number): Promise<void>;
  use(id: string, input: PromptUseInput): Promise<PromptUseResult>;
}
