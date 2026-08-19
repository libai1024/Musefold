import type { Kysely } from 'kysely';
import Provider, {
  errors,
  type Configuration,
  type Provider as OidcProvider,
} from 'oidc-provider';
import type { WebApiConfig } from '../../config.js';
import type { MusefoldDatabase } from '../../database/types.js';
import { MCP_SCOPES } from './service.js';
import { createPostgresOidcAdapter } from './postgres-adapter.js';

export const OAUTH_PATH = '/api/musefold/v1/oauth';
export const OAUTH_INTERACTION_PATH = `${OAUTH_PATH}/interaction`;

export function createCloudOidcProvider(
  db: Kysely<MusefoldDatabase>,
  config: Pick<
    WebApiConfig,
    | 'NODE_ENV'
    | 'PUBLIC_ORIGIN'
    | 'MCP_RESOURCE_URL'
    | 'SESSION_ENCRYPTION_KEY'
    | 'OAUTH_JWKS_JSON'
  >,
): OidcProvider {
  const secureCookies = new URL(config.PUBLIC_ORIGIN).protocol === 'https:';
  const configuration: Configuration = {
    adapter: createPostgresOidcAdapter(db),
    clientAuthMethods: ['none'],
    clientDefaults: {
      application_type: 'web',
      response_types: ['code'],
      grant_types: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_method: 'none',
    },
    clientBasedCORS: (_ctx, origin, client) =>
      client.redirectUris?.some((uri) => new URL(uri).origin === origin) ??
      false,
    cookies: {
      keys: [config.SESSION_ENCRYPTION_KEY],
      names: {
        session: '_mf_oidc_session',
        interaction: '_mf_oidc_interaction',
        resume: '_mf_oidc_resume',
      },
      long: {
        httpOnly: true,
        sameSite: 'lax',
        secure: secureCookies,
      },
      short: {
        httpOnly: true,
        sameSite: 'lax',
        secure: secureCookies,
      },
    },
    features: {
      devInteractions: { enabled: false },
      registration: {
        enabled: true,
        issueRegistrationAccessToken: false,
      },
      registrationManagement: { enabled: false },
      revocation: {
        enabled: true,
        allowedPolicy: async (_ctx, client, token) =>
          token.clientId === client.clientId,
      },
      resourceIndicators: {
        enabled: true,
        defaultResource: async (_ctx, _client, oneOf) => {
          if (oneOf?.includes(config.MCP_RESOURCE_URL)) {
            return config.MCP_RESOURCE_URL;
          }
          return config.MCP_RESOURCE_URL;
        },
        useGrantedResource: async () => true,
        getResourceServerInfo: async (_ctx, resourceIndicator) => {
          if (resourceIndicator !== config.MCP_RESOURCE_URL) {
            throw new errors.InvalidTarget('Musefold MCP resource 不匹配');
          }
          return {
            audience: config.MCP_RESOURCE_URL,
            scope: MCP_SCOPES.join(' '),
            accessTokenFormat: 'opaque',
            accessTokenTTL: 1_800,
          };
        },
      },
    },
    findAccount: async (_ctx, accountId) => ({
      accountId,
      claims: async () => ({ sub: accountId }),
    }),
    interactions: {
      url: async (_ctx, interaction) =>
        `${OAUTH_INTERACTION_PATH}/${interaction.uid}`,
    },
    issueRefreshToken: async () => true,
    jwks: parseJwks(config.OAUTH_JWKS_JSON),
    pkce: { required: () => true },
    responseTypes: ['code'],
    rotateRefreshToken: true,
    routes: {
      authorization: `${OAUTH_PATH}/authorize`,
      token: `${OAUTH_PATH}/token`,
      registration: `${OAUTH_PATH}/register`,
      revocation: `${OAUTH_PATH}/revoke`,
      jwks: `${OAUTH_PATH}/jwks`,
    },
    // MCP scopes belong to the resource server, not to the provider's OIDC scope set.
    scopes: ['offline_access'],
    subjectTypes: ['public'],
    ttl: {
      AccessToken: 1_800,
      AuthorizationCode: 300,
      Interaction: 600,
      RefreshToken: 2_592_000,
      Session: 2_592_000,
      Grant: 2_592_000,
    },
  };

  const provider = new Provider(config.PUBLIC_ORIGIN, configuration);
  provider.proxy = config.NODE_ENV === 'production';
  return provider;
}

function parseJwks(raw: string | undefined): Configuration['jwks'] {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as Configuration['jwks'];
    if (!value || !Array.isArray(value.keys) || !value.keys.length) {
      throw new Error('JWKS keys must be a non-empty array');
    }
    return value;
  } catch (error) {
    throw new Error('OAUTH_JWKS_JSON is not valid JWKS JSON', { cause: error });
  }
}
