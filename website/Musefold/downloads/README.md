# Musefold website downloads

Large release binaries are stored on the deployment server rather than copied
into the source tree. The website links to `/Musefold/api/download?platform=...&version=latest`,
which maps to a whitelisted file in `/Musefold/downloads/<version>/` and issues a `302`.

Pushing a `v*` tag runs GitHub-hosted macOS/Windows packaging, then the
`musefold-prod` runner copies installers onto the site and rewrites `catalog.json`.
The homepage reads `currentVersion` from `/Musefold/api/download-stats`.

These packages are unsigned internal-test builds until Developer ID / Authenticode
are configured. Do not write unsigned builds into `/Musefold/updates/stable/`.
Prerelease updater feeds go to `/Musefold/updates/dev/`.
