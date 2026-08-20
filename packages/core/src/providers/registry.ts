// electron/providers/registry.ts
// Provider 工厂 + 注册表 —— 详见 docs/05-image-generation.md §2.2

import type { ImageProvider } from '@musefold/desktop-contracts/providers';
import type { ProviderType } from '@musefold/desktop-contracts/enums';
import { OpenAICompatibleProvider } from './openai-compatible';
import { WukongStudioProvider } from './wukong-studio';
import { DoubaoWebProvider } from './doubao-web';

type ProviderFactory = (id: string, baseUrl: string, model: string, name: string) => ImageProvider;

const registry = new Map<ProviderType, ProviderFactory>();

registry.set('openai', (id, baseUrl, model, name) =>
  new OpenAICompatibleProvider(id, baseUrl, model, name)
);
registry.set('openai-compatible', (id, baseUrl, model, name) =>
  new OpenAICompatibleProvider(id, baseUrl, model, name)
);
registry.set('wukong-studio', (id, baseUrl, model, name) =>
  new WukongStudioProvider(id, baseUrl, model, name)
);
registry.set('doubao-web', (id, baseUrl, model, name) =>
  new DoubaoWebProvider(id, baseUrl, model, name)
);

export function createProvider(
  type: ProviderType,
  id: string,
  baseUrl: string,
  model: string,
  name: string
): ImageProvider {
  const factory = registry.get(type);
  if (!factory) throw new Error(`Unknown provider type: ${type}`);
  return factory(id, baseUrl, model, name);
}
