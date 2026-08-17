export { candidateDataDirs, discoverEndpoint, type DiscoveredEndpoint } from './discover';
export {
  discoverOrStartEndpoint,
  type DiscoverOrStartOptions,
} from './autostart';
export {
  MusefoldClient,
  MusefoldClientError,
  type ClientErrorEnvelope,
  type MusefoldClientOptions,
  type GenerationDetail,
  type ProviderSetupDraft,
  type SetupStatus,
  type SseEvent,
  type WaitForGenerationOptions,
} from './client';
