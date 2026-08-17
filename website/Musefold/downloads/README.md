# Musefold website downloads

Large release binaries are stored on the deployment server rather than copied
into the source tree. The website links to the download event service, which
maps a platform and version to a whitelisted file in
`/Musefold/downloads/<version>/` before issuing a `302` redirect.

The current public test files are Musefold `0.5.0-dev` for macOS Apple Silicon
and Windows x64. They are unsigned internal-test packages, not production releases.

For every production release:

1. Upload signed and verified installers plus SHA-256 checksums.
2. Add the platform/version paths to
   `services/musefold-downloads/catalog.json`.
3. Update the website version and system-requirement copy.
4. Publish release notes and the electron-updater manifests under
   `/Musefold/updates/stable/`.
5. Keep the previous signed version available as the rollback target.
