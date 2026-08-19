#!/usr/bin/env node

/**
 * Explicit staging smoke for the cookie-authenticated Web API.
 * It is intentionally opt-in: generation and prompt mutations can spend quota
 * or create test data, so CI must state those intentions in environment flags.
 */

import process from "node:process";

const HELP = `Usage: npm run test:staging:v1.1

Required:
  MUSEFOLD_STAGING_BASE_URL       Web origin, for example https://staging.example.com
  MUSEFOLD_STAGING_USERNAME       isolated staging account
  MUSEFOLD_STAGING_PASSWORD       isolated staging password

Optional:
  MUSEFOLD_STAGING_AUTH_MODE=login|register (default: login)
  MUSEFOLD_STAGING_RUN_PROMPT_MUTATIONS=true
  MUSEFOLD_STAGING_RUN_REDEEM=true plus MUSEFOLD_STAGING_REDEEM_CODE
  MUSEFOLD_STAGING_RUN_GENERATION=true
  MUSEFOLD_STAGING_GENERATION_PROMPT=...
  MUSEFOLD_STAGING_GENERATION_TIMEOUT_SECONDS=180 (default: 180)
  MUSEFOLD_STAGING_REQUIRE_OPENAPI=false (default: true)
`;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}

const env = process.env;
const baseUrl = required("MUSEFOLD_STAGING_BASE_URL");
const username = required("MUSEFOLD_STAGING_USERNAME");
const password = required("MUSEFOLD_STAGING_PASSWORD");
const origin = parseBaseUrl(baseUrl);
const apiBase = `${origin}/api/musefold/v1`;
let cookieJar;
let csrfToken = null;
const checks = [];

function required(name) {
  const value = env[name]?.trim();
  if (!value) fail(`缺少 ${name}。运行 --help 查看 staging smoke 前置条件。`);
  return value;
}

function parseBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail("MUSEFOLD_STAGING_BASE_URL 必须是有效的 HTTP(S) URL");
  }
  if (!parsed.pathname || parsed.pathname === "/") return parsed.origin;
  return parsed.origin + parsed.pathname.replace(/\/+$/, "");
}

function fail(message) {
  console.error(`[staging] FAIL ${message}`);
  process.exit(2);
}

function pass(name, detail = "") {
  checks.push({ name, detail });
  console.log(`[staging] PASS ${name}${detail ? ` · ${detail}` : ""}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, init = {}, { csrf = false, expect = 200 } = {}) {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  const cookie = cookieJar.header();
  if (cookie) headers.set("Cookie", cookie);
  if (csrf) headers.set("X-Musefold-CSRF", csrfToken ?? "");
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers,
    redirect: "manual",
  });
  cookieJar.capture(response.headers);
  const body = await response.text();
  if (response.status !== expect) {
    let detail = `HTTP ${response.status}`;
    try {
      const parsed = JSON.parse(body);
      detail = parsed?.error?.code ?? detail;
    } catch {
      // Never print arbitrary upstream response bodies in staging logs.
    }
    throw new Error(`${init.method ?? "GET"} ${path} failed: ${detail}`);
  }
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${init.method ?? "GET"} ${path} returned invalid JSON`);
  }
}

async function health() {
  const live = await fetch(`${origin}/health/live`);
  assert(live.ok, `health/live returned HTTP ${live.status}`);
  pass("health/live");
  const ready = await fetch(`${origin}/health/ready`);
  assert(ready.ok, `health/ready returned HTTP ${ready.status}`);
  pass("health/ready");
}

async function openApiSmoke() {
  if (env.MUSEFOLD_STAGING_REQUIRE_OPENAPI === "false") return;
  const response = await fetch(`${origin}/api/musefold/v1/openapi.json`, {
    headers: { Accept: "application/json" },
  });
  assert(response.ok, `openapi endpoint returned HTTP ${response.status}`);
  const document = await response.json();
  const paths = document?.paths;
  const requiredPaths = [
    "/api/musefold/v1/auth/login",
    "/api/musefold/v1/prompts",
    "/api/musefold/v1/generations",
    "/api/musefold/mcp",
  ];
  assert(
    requiredPaths.every((path) => paths?.[path]),
    `openapi is missing ${requiredPaths.filter((path) => !paths?.[path]).join(", ")}`,
  );
  pass("OpenAPI route contract", `${Object.keys(paths).length} paths`);
}

async function authenticate() {
  const mode = env.MUSEFOLD_STAGING_AUTH_MODE?.trim() || "login";
  assert(mode === "login" || mode === "register", "AUTH_MODE must be login or register");
  const session = await request(`/auth/${mode}`, {
    method: "POST",
    body: JSON.stringify({
      username,
      password,
      ...(mode === "register" ? { displayName: "Musefold staging" } : {}),
    }),
  });
  assert(session?.account?.id, "auth response did not include an account");
  csrfToken = session.csrfToken;
  assert(typeof csrfToken === "string" && csrfToken.length >= 32, "auth response did not include CSRF");
  const current = await request("/auth/me");
  assert(current?.account?.id === session.account.id, "auth/me account mismatch");
  pass(`auth/${mode}`, "cookie session and CSRF established");
  return session.account;
}

async function readCoreSurfaces() {
  const [prompts, sessions, history] = await Promise.all([
    request("/prompts?limit=20"),
    request("/workbench/sessions?limit=20"),
    request("/generations?limit=20"),
  ]);
  assert(Array.isArray(prompts?.items), "prompts response is not a page");
  assert(Array.isArray(sessions?.items), "workbench response is not a page");
  assert(Array.isArray(history?.items), "generation history response is not a page");
  pass("prompt library, workbench and history reads");
}

async function promptMutationSmoke() {
  if (env.MUSEFOLD_STAGING_RUN_PROMPT_MUTATIONS !== "true") return;
  const marker = `staging-${Date.now()}`;
  let created = null;
  try {
    created = await request("/prompts", {
      method: "POST",
      body: JSON.stringify({
        title: marker,
        description: "temporary staging smoke record",
        content: "A quiet Musefold staging smoke test image",
        negative: null,
        folderId: null,
        tagIds: [],
        modelId: null,
        params: null,
        source: "manual",
        sourceUrl: null,
      }),
    }, { csrf: true, expect: 201 });
    const updated = await request(`/prompts/${encodeURIComponent(created.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        expectedVersion: created.version,
        description: "updated staging smoke record",
      }),
    }, { csrf: true });
    assert(updated.version > created.version, "prompt version did not increment");
    const deleted = await request(`/prompts/${encodeURIComponent(created.id)}`, {
      method: "DELETE",
      body: JSON.stringify({ expectedVersion: updated.version }),
    }, { csrf: true });
    assert(deleted.deletedAt, "prompt delete did not soft-delete");
    const restored = await request(`/prompts/${encodeURIComponent(created.id)}/restore`, {
      method: "POST",
      body: JSON.stringify({ expectedVersion: deleted.version }),
    }, { csrf: true });
    assert(!restored.deletedAt, "prompt restore did not clear deletedAt");
    pass("prompt create/update/delete/restore", "temporary record restored");
  } finally {
    if (created?.id) {
      const current = await request(`/prompts/${encodeURIComponent(created.id)}`).catch(() => null);
      if (current && !current.deletedAt) {
        await request(`/prompts/${encodeURIComponent(created.id)}`, {
          method: "DELETE",
          body: JSON.stringify({ expectedVersion: current.version }),
        }, { csrf: true }).catch(() => undefined);
      }
    }
  }
}

async function redeemSmoke() {
  if (env.MUSEFOLD_STAGING_RUN_REDEEM !== "true") return;
  const code = required("MUSEFOLD_STAGING_REDEEM_CODE");
  const result = await request("/auth/redeem", {
    method: "POST",
    body: JSON.stringify({ code }),
  }, { csrf: true });
  assert(result?.account?.id, "redeem response did not include account");
  pass("new-api redeem", "explicitly enabled");
}

async function generationSmoke() {
  if (env.MUSEFOLD_STAGING_RUN_GENERATION !== "true") return;
  const prompt = env.MUSEFOLD_STAGING_GENERATION_PROMPT?.trim() ||
    "A clean editorial postcard for Musefold staging verification, soft daylight, no text";
  const idempotencyKey = `staging-smoke-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const input = {
    prompt,
    size: "1024x1024",
    aspectRatio: "1:1",
    quality: "low",
    count: 1,
  };
  const first = await request("/generations", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(input),
  }, { csrf: true, expect: 202 });
  const second = await request("/generations", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(input),
  }, { csrf: true, expect: 202 });
  assert(first?.id && first.id === second?.id, "idempotency key created more than one run");
  pass("generation create/idempotency", first.id);

  const timeoutSeconds = Number(env.MUSEFOLD_STAGING_GENERATION_TIMEOUT_SECONDS || 180);
  const deadline = Date.now() + Math.max(30, timeoutSeconds) * 1_000;
  let job = first;
  while (["pending_approval", "queued", "running", "cancelling"].includes(job.status)) {
    if (Date.now() > deadline) throw new Error("staging generation timed out");
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    job = await request(`/generations/${encodeURIComponent(first.id)}`);
  }
  assert(["succeeded", "failed", "cancelled", "rejected", "expired"].includes(job.status), "generation did not reach terminal state");
  pass("generation terminal state", job.status);

  const eventsResponse = await fetch(`${apiBase}/generations/${encodeURIComponent(first.id)}/events?after=0`, {
    headers: { Accept: "text/event-stream", Cookie: cookieJar.header() },
  });
  assert(eventsResponse.ok, `generation SSE returned HTTP ${eventsResponse.status}`);
  const eventsText = await eventsResponse.text();
  const sequences = [...eventsText.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]));
  assert(sequences.length > 0, "generation SSE returned no durable event");
  pass("generation SSE replay", `${sequences.length} events`);

  if (job.status !== "succeeded") return;
  assert(job.assets?.length > 0, "succeeded generation has no assets");
  const assetUrl = resolveAssetUrl(job.assets[0].url);
  const assetResponse = await fetch(assetUrl, {
    headers: { Cookie: cookieJar.header() },
    redirect: "follow",
  });
  assert(assetResponse.ok, `signed asset fetch returned HTTP ${assetResponse.status}`);
  assert(assetResponse.headers.get("content-type")?.startsWith("image/"), "asset is not an image");
  pass("signed asset fetch", assetResponse.headers.get("content-type") || "image");
}

function resolveAssetUrl(value) {
  const parsed = new URL(value, origin);
  if (parsed.origin !== origin) return parsed.toString();
  return parsed.toString();
}

class CookieJar {
  #values = new Map();

  capture(headers) {
    const values = typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : (headers.get("set-cookie") ? [headers.get("set-cookie")] : []);
    for (const value of values) {
      const pair = value.split(";", 1)[0];
      const separator = pair.indexOf("=");
      if (separator < 1) continue;
      const name = pair.slice(0, separator);
      const content = pair.slice(separator + 1);
      if (!content) this.#values.delete(name);
      else this.#values.set(name, content);
    }
  }

  header() {
    return [...this.#values.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

cookieJar = new CookieJar();

try {
  await health();
  await openApiSmoke();
  await authenticate();
  await readCoreSurfaces();
  await promptMutationSmoke();
  await redeemSmoke();
  await generationSmoke();
  console.log(`[staging] COMPLETE ${checks.length} checks`);
} catch (error) {
  console.error(`[staging] FAIL ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
}
