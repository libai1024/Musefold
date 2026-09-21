export {
  DESKTOP_CAPABILITIES,
  type PlatformCapabilities,
  WEB_CAPABILITIES,
} from './capabilities';
export {
  PlatformProvider,
  type BuildInfo,
  type PlatformRuntime,
  useBuildInfo,
  useCapabilities,
  useGateway,
  usePlatform,
} from './context';
export type {
  AccountGateway,
  AiProvidersGateway,
  CloudMcpGateway,
  DesignSchemesGateway,
  DesignSchemePackageImportGateway,
  DesignSchemePackageExportGateway,
  DesignSchemePackageSaveOptions,
  DoubaoGateway,
  GenerationGateway,
  MusefoldGateway,
  PromptsGateway,
  SettingsGateway,
  SyncGateway,
  UsageGateway,
  WorkbenchGateway,
} from './gateway';
export {
  DESIGN_SCHEMES_CAPABILITY_UNAVAILABLE,
  PlatformCapabilityError,
  requireDesignSchemes,
} from './design-schemes';
export { requireDoubao } from './doubao';
export type { DesignSchemeAgentGateway } from './design-scheme-agent';
export { queryKeys } from './query-keys';
export {
  DESIGN_SCHEME_METHOD_NAMES,
  DESIGN_SCHEME_WIRE_METHODS,
  V25_METHOD_NAMES,
  type DesignSchemeMethodName,
  type V25MethodName,
} from '@musefold/contracts';
