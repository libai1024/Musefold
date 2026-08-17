export {
  AUTOMATION_API_VERSION,
  DEFAULT_GENERATION_RATE_LIMIT,
  DEFAULT_JSON_DEPTH_LIMIT,
  DEFAULT_REQUEST_BODY_LIMIT,
  DEFAULT_RATE_LIMIT,
  DEFAULT_UPLOAD_BODY_LIMIT,
  AutomationError,
  createAutomationServer,
  type AuditRecord,
  type AutomationRouteContext,
  type AutomationRouteHandler,
  type AutomationServer,
  type AutomationServerInfo,
  type AutomationServerOptions,
} from './server';
export {
  DISCOVERY_FILE_NAME,
  discoveryFileMode,
  discoveryFilePath,
  readDiscoveryFile,
  removeDiscoveryFile,
  removeDiscoveryFileIfOwned,
  writeDiscoveryFile,
  type DiscoveryDocument,
} from './discovery';
export { TOKEN_PREFIX, bearerToken, generateToken, tokenEquals } from './token';
export { createV1ReadRoutes } from './routes';
export { createLocalRoutes, type LocalAdminOps, type LocalRoutesResult } from './local-routes';
export {
  OWNER_LOCK_FILE,
  acquireOwnerLock,
  currentOwner,
  type AcquireResult,
  type OwnerLockInfo,
} from './owner-lock';
export {
  CONFIRMATION_TIMEOUT_MS,
  MAX_GENERATION_N,
  DEFAULT_BREAKER_THRESHOLD,
  DEFAULT_BREAKER_COOLDOWN_MS,
  createGenerationGate,
  type GenerationGateOptions,
  type SpendAuditDraft,
  type ConfirmationSummary,
  type GenerationBudget,
  type GenerationEstimate,
  type GenerationGate,
  type GenerationHost,
  type GenerationRequestBody,
} from './generation-routes';
