#!/usr/bin/env node

/**
 * Full Cloud MCP staging verification for the read-only v2.1 contract.
 *
 * The script verifies OAuth PKCE, the exact read-only tool catalog, prompt/Skill
 * reads, refresh rotation and revocation. It never creates prompts or jobs.
 */

import { createHash, randomBytes } from 'node:crypto';
import process from 'node:process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const HELP = `Usage: npm run test:staging:mcp-full

Required:
  MUSEFOLD_STAGING_BASE_URL       Web origin, for example http://127.0.0.1:60162
  MUSEFOLD_STAGING_USERNAME       isolated staging account
  MUSEFOLD_STAGING_PASSWORD       isolated staging password

Optional:
  MUSEFOLD_STAGING_MCP_REQUIRE_SKILL=false  allow an empty published Skill catalog
  MUSEFOLD_STAGING_MCP_KEEP_ARTIFACTS=true  keep the OAuth connection

Credentials and OAuth tokens are never printed.
`;

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(HELP);
  process.exit(0);
}

const env = process.env;
const serviceBase = parseBaseUrl(required('MUSEFOLD_STAGING_BASE_URL'));
const username = required('MUSEFOLD_STAGING_USERNAME');
const password = required('MUSEFOLD_STAGING_PASSWORD');
const apiBase = `${serviceBase}/api/musefold/v1`;
const mcpUrl = `${serviceBase}/api/musefold/mcp`;
const oauthBase = `${apiBase}/oauth`;
const requireSkill = env.MUSEFOLD_STAGING_MCP_REQUIRE_SKILL !== 'false';
const keepArtifacts = env.MUSEFOLD_STAGING_MCP_KEEP_ARTIFACTS === 'true';
const clientName = `Musefold MCP read-only smoke ${Date.now()}-${randomBytes(3).toString('hex')}`;
const redirectUri = `${serviceBase}/Musefold/app/mcp-test-callback`;
const scopes = ['account:read', 'prompts:read', 'skills:read'];
const expectedTools = [
  'get_account_status',
  'get_prompt',
  'get_skill',
  'list_models',
  'list_skills',
  'musefold_status',
  'search_prompts',
];
const forbiddenTools = [
  'save_prompt',
  'generate_image',
  'estimate_generation',
  'get_generation',
  'wait_for_generation',
  'cancel_generation',
  'list_history',
];

const cookies = createCookieJar();
const clients = [];
const accessTokens = new Set();
let csrfToken = null;
let clientId = null;
let refreshToken = null;
let connectionId = null;
let mainError = null;

try {
  await verifyHttpBoundary();
  await login();
  const token = await authorize();
  accessTokens.add(token.accessToken);
  refreshToken = token.refreshToken;
  await discoverConnection();
  await verifyTools(token.accessToken);
  await verifyRefreshAndRevocation();
} catch (error) {
  mainError = error;
  console.error(`[mcp-full] FAIL ${message(error)}`);
} finally {
  const cleanupErrors = await cleanup();
  for (const error of cleanupErrors) console.error(`[mcp-full] CLEANUP FAIL ${message(error)}`);
  if (mainError || cleanupErrors.length) process.exitCode = 1;
  else console.log('[mcp-full] COMPLETE');
}

async function verifyHttpBoundary() {
  const badOrigin = await fetch(mcpUrl, {
    method: 'POST',
    headers: { Origin: 'https://invalid.example', 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert(badOrigin.status === 403, `origin guard returned HTTP ${badOrigin.status}`);
  pass('origin guard');

  const unauthorized = await fetch(mcpUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert(
    unauthorized.status === 401,
    `unauthorized challenge returned HTTP ${unauthorized.status}`,
  );
  assert(
    unauthorized.headers.get('www-authenticate')?.includes('resource_metadata'),
    'unauthorized challenge omitted protected resource metadata',
  );
  pass('unauthorized challenge');
}

async function login() {
  const response = await request(`${apiBase}/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  const body = await responseJson(response, 'Web login');
  assert(response.status === 200, apiError('Web login', response, body));
  assert(typeof body.csrfToken === 'string', 'Web login did not return a CSRF token');
  csrfToken = body.csrfToken;
  pass('Web login', 'cookie + CSRF');
}

async function authorize() {
  const registration = await request(`${oauthBase}/register`, {
    method: 'POST',
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [redirectUri],
      response_types: ['code'],
      grant_types: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_method: 'none',
    }),
  });
  const registrationBody = await responseJson(registration, 'OAuth registration');
  assert(
    [200, 201].includes(registration.status),
    apiError('OAuth registration', registration, registrationBody),
  );
  assert(typeof registrationBody.client_id === 'string', 'OAuth registration omitted client_id');
  clientId = registrationBody.client_id;
  pass('OAuth dynamic registration');

  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const authorizeUrl = new URL(`${oauthBase}/authorize`);
  for (const [name, value] of Object.entries({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: mcpUrl,
    state: randomBytes(12).toString('hex'),
  }))
    authorizeUrl.searchParams.set(name, value);

  const authorization = await request(authorizeUrl, {}, { redirect: 'manual' });
  const interactionUrl = redirectLocation(authorization, authorizeUrl, 'OAuth authorization');
  const consent = await request(interactionUrl);
  const consentHtml = await consent.text();
  assert(consent.status === 200, `OAuth consent returned HTTP ${consent.status}`);
  for (const label of ['账户信息', '提示词·读', '技能·读'])
    assert(consentHtml.includes(label), `OAuth consent omitted ${label}`);
  const consentCsrf = /name="csrf" value="([^"]+)"/.exec(consentHtml)?.[1];
  assert(consentCsrf, 'OAuth consent page omitted its CSRF token');

  const approved = await request(
    interactionUrl,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf: consentCsrf, decision: 'approve' }).toString(),
    },
    { redirect: 'manual' },
  );
  const finishUrl = redirectLocation(approved, interactionUrl, 'OAuth consent');
  const finished = await request(finishUrl, {}, { redirect: 'manual' });
  const callbackUrl = redirectLocation(finished, finishUrl, 'OAuth authorization completion');
  assert(
    callbackUrl.origin + callbackUrl.pathname ===
      new URL(redirectUri).origin + new URL(redirectUri).pathname,
    'OAuth authorization redirected to an unexpected callback',
  );
  const code = callbackUrl.searchParams.get('code');
  assert(code, 'OAuth callback omitted authorization code');
  pass('OAuth PKCE consent');

  const tokenResponse = await formRequest(`${oauthBase}/token`, {
    grant_type: 'authorization_code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code,
    code_verifier: verifier,
    resource: mcpUrl,
  });
  const tokenBody = await responseJson(tokenResponse, 'OAuth token exchange');
  assert(tokenResponse.status === 200, apiError('OAuth token exchange', tokenResponse, tokenBody));
  assert(typeof tokenBody.access_token === 'string', 'OAuth token exchange omitted access_token');
  assert(typeof tokenBody.refresh_token === 'string', 'OAuth token exchange omitted refresh_token');
  pass('OAuth token exchange');
  return { accessToken: tokenBody.access_token, refreshToken: tokenBody.refresh_token };
}

async function discoverConnection() {
  const response = await webApi('/connections');
  const body = await responseJson(response, 'connection discovery');
  assert(response.status === 200, apiError('connection discovery', response, body));
  const connection = body.items?.find((item) => item.clientName === clientName);
  assert(typeof connection?.id === 'string', 'OAuth grant did not appear in connected apps');
  assert(
    JSON.stringify(connection.scopes?.sort()) === JSON.stringify(scopes.slice().sort()),
    'OAuth grant did not preserve the requested read-only scope subset',
  );
  connectionId = connection.id;
  pass('connected app discovery', 'requested scopes only');
}

async function verifyTools(accessToken) {
  const [first, second] = await Promise.all([
    openClient('musefold-mcp-read-only-a', accessToken),
    openClient('musefold-mcp-read-only-b', accessToken),
  ]);
  const [firstCatalog, secondCatalog] = await Promise.all([first.listTools(), second.listTools()]);
  assertToolCatalog(firstCatalog.tools, 'first client');
  assertToolCatalog(secondCatalog.tools, 'second client');
  pass('two independent clients and tools/list', `${expectedTools.length} tools`);

  const status = structured(
    await first.callTool({ name: 'musefold_status', arguments: {} }),
    'musefold_status',
  );
  assert(
    status.connected === true && status.surface === 'cloud',
    'musefold_status did not report connected cloud surface',
  );
  pass('musefold_status');

  const account = structured(
    await first.callTool({ name: 'get_account_status', arguments: {} }),
    'get_account_status',
  );
  assert(
    account.budget && typeof account.officialModelsAvailable === 'boolean',
    'get_account_status omitted capability or budget',
  );
  assert(
    !/password|access_token|refresh_token|serverUrl|apiKey|secret/i.test(JSON.stringify(account)),
    'get_account_status exposed sensitive fields',
  );
  pass('get_account_status');

  const models = structured(
    await first.callTool({ name: 'list_models', arguments: {} }),
    'list_models',
  );
  assert(Array.isArray(models.models), 'list_models omitted models');
  pass('list_models', `${models.models.length} official aliases`);

  const search = structured(
    await first.callTool({
      name: 'search_prompts',
      arguments: { q: 'mcp-read-only-smoke', limit: 20 },
    }),
    'search_prompts',
  );
  assert(Array.isArray(search.items), 'search_prompts omitted items');
  pass('search_prompts');

  const promptId = search.items[0]?.id;
  if (promptId) {
    const prompt = structured(
      await second.callTool({
        name: 'get_prompt',
        arguments: { id: promptId },
      }),
      'get_prompt',
    );
    assert(prompt && prompt.id === promptId, 'get_prompt returned a different prompt');
    pass('get_prompt');
  } else {
    skip('get_prompt', 'staging prompt library is empty');
  }

  const skillList = structured(
    await first.callTool({ name: 'list_skills', arguments: {} }),
    'list_skills',
  );
  assert(Array.isArray(skillList.skills), 'list_skills omitted skills');
  pass('list_skills', `${skillList.skills.length} published`);
  if (skillList.skills.length > 0) {
    const selected = skillList.skills[0];
    const skill = structured(
      await second.callTool({
        name: 'get_skill',
        arguments: { id: selected.id, version: selected.version },
      }),
      'get_skill',
    );
    assert(
      skill.id === selected.id && skill.version === selected.version && skill.contentHash,
      'get_skill returned an incomplete pinned Skill',
    );
    pass('get_skill');
  } else if (requireSkill) {
    throw new Error('get_skill cannot be verified because staging has no published Skill');
  } else {
    skip('get_skill', 'staging has no published Skill');
  }
}

async function verifyRefreshAndRevocation() {
  assert(clientId && refreshToken, 'OAuth refresh prerequisites are missing');
  const response = await formRequest(`${oauthBase}/token`, {
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: refreshToken,
    resource: mcpUrl,
  });
  const body = await responseJson(response, 'OAuth refresh');
  assert(response.status === 200, apiError('OAuth refresh', response, body));
  assert(
    typeof body.access_token === 'string' && typeof body.refresh_token === 'string',
    'OAuth refresh omitted rotated tokens',
  );
  accessTokens.add(body.access_token);
  refreshToken = body.refresh_token;
  pass('OAuth refresh');

  await revokeToken(body.access_token, 'access_token');
  accessTokens.delete(body.access_token);
  const rejected = await fetch(mcpUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${body.access_token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert(rejected.status === 401, `revoked MCP token returned HTTP ${rejected.status}`);
  pass('OAuth revoke and revoked-token rejection');
}

async function cleanup() {
  const errors = [];
  await Promise.all(
    clients.splice(0).map((client) => client.close().catch((error) => errors.push(error))),
  );
  if (keepArtifacts) {
    console.log('[mcp-full] KEEP OAuth connection by request');
    return errors;
  }
  for (const token of accessTokens)
    await cleanupStep(errors, 'access token', () => revokeToken(token, 'access_token'));
  if (refreshToken)
    await cleanupStep(errors, 'refresh token', () => revokeToken(refreshToken, 'refresh_token'));
  if (connectionId)
    await cleanupStep(errors, 'OAuth connection', async () => {
      const response = await webApi(
        `/connections/${encodeURIComponent(connectionId)}`,
        { method: 'DELETE' },
        { csrf: true },
      );
      if (![204, 404].includes(response.status)) {
        const body = await responseJson(response, 'connection cleanup');
        throw new Error(apiError('connection cleanup', response, body));
      }
    });
  if (!errors.length) pass('temporary OAuth artifact cleanup');
  return errors;
}

async function cleanupStep(errors, label, operation) {
  try {
    await operation();
  } catch (error) {
    errors.push(new Error(`${label}: ${message(error)}`));
  }
}

async function revokeToken(token, hint) {
  if (!clientId) return;
  const response = await formRequest(`${oauthBase}/revoke`, {
    token,
    client_id: clientId,
    token_type_hint: hint,
  });
  assert(response.status === 200, `OAuth revoke returned HTTP ${response.status}`);
}

async function openClient(name, accessToken) {
  const client = new Client({ name, version: '2.1.0-read-only-smoke' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(mcpUrl), {
      requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
    }),
  );
  clients.push(client);
  return client;
}

function assertToolCatalog(tools, label) {
  const actual = tools.map((tool) => tool.name).sort();
  assert(
    JSON.stringify(actual) === JSON.stringify(expectedTools),
    `${label} tool catalog mismatch: ${actual.join(', ')}`,
  );
  assert(
    !actual.some((name) => forbiddenTools.includes(name)),
    `${label} exposed forbidden Cloud MCP tool`,
  );
}

function structured(result, label) {
  assert(!result.isError, `${label} returned an MCP error`);
  assert(result.structuredContent !== undefined, `${label} omitted structuredContent`);
  return result.structuredContent;
}

async function webApi(path, init = {}, options = {}) {
  const headers = new Headers(init.headers);
  if (options.csrf) headers.set('X-Musefold-CSRF', csrfToken ?? '');
  return request(`${apiBase}${path}`, { ...init, headers });
}

async function formRequest(url, values) {
  return request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(values).toString(),
  });
}

async function request(url, init = {}, options = {}) {
  const target = url instanceof URL ? url : new URL(url);
  const headers = new Headers(init.headers);
  headers.set('Accept', headers.get('Accept') ?? 'application/json');
  if (init.body !== undefined && !headers.has('Content-Type'))
    headers.set('Content-Type', 'application/json');
  const cookie = cookies.header(target);
  if (cookie) headers.set('Cookie', cookie);
  const response = await fetch(target, {
    ...init,
    headers,
    redirect: options.redirect ?? 'manual',
  });
  cookies.capture(response.headers);
  return response;
}

async function responseJson(response, label) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned non-JSON HTTP ${response.status}`);
  }
}

function redirectLocation(response, base, label) {
  assert(
    response.status >= 300 && response.status < 400,
    `${label} returned HTTP ${response.status}`,
  );
  const location = response.headers.get('location');
  assert(location, `${label} omitted Location`);
  return new URL(location, base);
}

function apiError(label, response, body) {
  const code = body?.error?.code ?? body?.error ?? body?.code;
  const retry = response.headers.get('retry-after');
  return `${label} returned HTTP ${response.status}${code ? ` (${code})` : ''}${retry ? `; retry after ${retry}s` : ''}`;
}

function required(name) {
  const value = env[name]?.trim();
  if (!value) {
    console.error(`[mcp-full] FAIL missing ${name}. Run with --help for requirements.`);
    process.exit(2);
  }
  return value;
}

function parseBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    console.error('[mcp-full] FAIL MUSEFOLD_STAGING_BASE_URL must be an HTTP(S) URL');
    process.exit(2);
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    console.error('[mcp-full] FAIL MUSEFOLD_STAGING_BASE_URL is not a safe service URL');
    process.exit(2);
  }
  return parsed.origin + (parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, ''));
}

function assert(condition, detail) {
  if (!condition) throw new Error(detail);
}
function pass(name, detail = '') {
  console.log(`[mcp-full] PASS ${name}${detail ? ` · ${detail}` : ''}`);
}
function skip(name, detail) {
  console.log(`[mcp-full] SKIP ${name} · ${detail}`);
}
function message(error) {
  return error instanceof Error ? error.message : String(error);
}

function createCookieJar() {
  const items = new Map();
  return {
    capture(headers) {
      const values =
        typeof headers.getSetCookie === 'function'
          ? headers.getSetCookie()
          : [headers.get('set-cookie')].filter(Boolean);
      for (const raw of values) {
        const parts = raw.split(';').map((part) => part.trim());
        const separator = parts[0].indexOf('=');
        if (separator < 1) continue;
        const name = parts[0].slice(0, separator);
        const value = parts[0].slice(separator + 1);
        let path = '/';
        let maxAge = null;
        for (const attribute of parts.slice(1)) {
          const index = attribute.indexOf('=');
          const key = (index < 0 ? attribute : attribute.slice(0, index)).toLowerCase();
          const attributeValue = index < 0 ? '' : attribute.slice(index + 1);
          if (key === 'path' && attributeValue) path = attributeValue;
          if (key === 'max-age') maxAge = Number(attributeValue);
        }
        const key = `${name}|${path}`;
        if (!value || maxAge === 0) items.delete(key);
        else items.set(key, { name, value, path });
      }
    },
    header(url) {
      return [...items.values()]
        .filter((cookie) => url.pathname.startsWith(cookie.path))
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join('; ');
    },
  };
}
