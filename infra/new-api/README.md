# New API login-session extension

Target: QuantumNous/new-api commit `5c3abffe8572aa8a49f15c3916707d2019d66af4`
(the existing production `v1.0.0-rc.24` image). Upstream branding and license are
preserved. This directory contains only the additive Musefold session extension,
not a replacement API/billing implementation.

Apply to a fresh extracted archive:

```sh
node infra/new-api/apply-session-extension.mjs /absolute/path/to/new-api-source
```

The script validates every patch anchor before writing. Do not apply twice.
Build/test in Go 1.25.1, with the upstream workspace/relaykit retained. The new
columns are additive GORM migrations with zero defaults for existing sessions.

Security decisions: managed login grants last five minutes and carry no business
authority. Fixed-selection replacement and ordinary session issuance share the
user-row lock. Candidates expire after five minutes unless acknowledged; idle
expiry is seven days of no explicit interaction, bounded by the existing absolute
expiry. Legacy sessions keep their old absolute expiry. Refresh and polling do
not count as interaction. Release capabilities can only revoke their one SID.

Authorization now reads the authoritative session row instead of trusting a
cached active snapshot. Both session and user security version are read from the
database (two reads per authentication) for an immediate, cross-process
revocation barrier, including rollback and late
cache-fill races. No Redis flush or global security-version reset is used.

Managed sessions persist policy version 1; legacy rows remain version 0. Daily
issuance is checked before a grant and again under the completion lock. A 429
response carries `retry_at` (Unix seconds); releasing devices cannot reset it.
Password/2FA entry retains upstream critical limits. Capability operations use a
separate 120/minute IP budget, so reviewing/releasing devices does not consume
password attempts. Authenticated release has its own per-user critical budget.

Verification (Go 1.25.1):

```sh
go test ./model ./service ./controller ./middleware -count=1 -timeout=180s
```

Set `MUSEFOLD_SESSION_TEST_DSN` to a **disposable** PostgreSQL database to enable
the two-process capacity contention test. It uses an isolated schema. The tests
also cover configured 2FA, delayed Redis cache fill, fixed-selection rollback,
retry and idle/absolute expiry.

Cross-language wire test: start only `TestManagedHTTPFixture` in the patched Go
tree with `MUSEFOLD_SESSION_HTTP_FIXTURE=1`; expose container port 18089 on
`127.0.0.1:18089` only. It uses an in-memory database and synthetic credentials.
Once `/__ready` returns 204, run from this repository:

```sh
MUSEFOLD_SESSION_HTTP_FIXTURE_URL=http://127.0.0.1:18089 \
  pnpm --filter @musefold/new-api-client exec vitest run \
  src/__tests__/managed-sessions.integration.test.ts
```

The test shuts the fixture down. Without the opt-in URL it is explicitly skipped,
not counted as a successful HTTP verification. The upstream Dockerfile builds
the full image, including its original frontend, from the patched source tree.

Production deployment is separate; an applied patch or local image is not a release.
