# Managed filesystem

Internal Node-API 8 directory handles for desktop staging. The desktop main process loads the binary from its trusted application resources; renderer and cloud packages cannot depend on this package.

`pnpm --filter @musefold/managed-fs run build` builds with pinned node-gyp and the local native toolchain. Root `dev`, `test` and `build` run this prerequisite. Build products are host-specific and ignored by Git. Electron packages include `build/Release/managed_fs.node` as `resources/native/managed_fs.node` outside ASAR. Build on each target OS and architecture; never reuse a macOS binary for Windows.

Callers pin the root by its expected filesystem identity, open descendants relative to directory handles, and close every directory/reader. `openFile` transfers the returned descriptor to the caller, which must close it. Exclusive file creation, no-follow opens and relative deletion prevent a changed directory pathname from redirecting IO. This does not grant authority to delete arbitrary entries: ownership, filename grammar, reference checks and retention rules remain the caller's responsibility.

POSIX uses openat/unlinkat and independent directory streams. Windows uses relative NT file handles and handle-based enumeration/deletion. Native unit tests and packaged Electron smoke tests must pass on each real target; macOS results do not prove Windows support. The package smoke test checks the packaged binary against the local build and imports a fixture through the actual UI/IPC path.
