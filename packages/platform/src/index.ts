export {
  DESKTOP_CAPABILITIES,
  type PlatformCapabilities,
  WEB_CAPABILITIES,
} from './capabilities';
export {
  PlatformProvider,
  type PlatformRuntime,
  useCapabilities,
  useGateway,
  usePlatform,
} from './context';
export type {
  AccountGateway,
  GenerationGateway,
  MusefoldGateway,
  PromptsGateway,
  SettingsGateway,
  WorkbenchGateway,
} from './gateway';
export { queryKeys } from './query-keys';
