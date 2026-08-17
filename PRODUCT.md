# Musefold Product

<!-- impeccable:product-schema 1 -->

## Product

Musefold helps individual creators turn reusable visual intent into generated images. It combines an image-generation workspace with a prompt library that can be searched, reused, refined, and retained across creation sessions.

## Surfaces

### Desktop

The desktop app is local-first and provides the complete product surface: image generation, local prompt storage, history, design schemes, Agent/Skills, local providers, CLI, MCP, and automation.

### Web v1.1

The Web app is cloud-first and supports desktop and mobile browsers. It provides personal accounts, a recoverable image-generation workbench, cloud generation history, cloud prompt storage and sync, prompt search/edit/copy/use, account quota, generated result download, and management for authorized Cloud MCP clients.

The Web app does not expose Agent execution, arbitrary GitHub Skill execution, design schemes, desktop CLI/local MCP, local files, BYOK providers, or team collaboration. Cloud MCP can use audited official Skills and the same cloud generation/history services after account OAuth authorization.

## Users

Individual creators who generate images frequently and need to reuse successful prompt assets without learning provider-specific configuration.

## Principles

- Keep creative intent visible and editable.
- Never spend credits without an explicit user action.
- Never expose provider credentials to the renderer or browser.
- Share domain contracts and UI components, not platform-specific storage or runtime code.
- Keep desktop local-first and Web cloud-first.
- Preserve prompt snapshots and generation status so interrupted sessions can recover.
- Treat account ownership as a hard data boundary.
- Support narrow desktop windows and mobile touch layouts from the beginning.

## Architecture Direction

Desktop and Web share TypeScript contracts, domain validation, application use cases, error codes, design tokens, and the same workbench/prompt/history React components. Electron IPC, SQLite, OS keychain, local Provider implementations, and Automation stay desktop-only. Web uses a Node 24/Fastify modular API, PostgreSQL/Kysely, Graphile Worker jobs, and external S3-compatible object storage. Cloud MCP is an isolated Fastify module in the Web API for P0; Local and Cloud MCP share tool definitions but use separate backend adapters and transports.

The detailed v1.1 architecture is defined in `docs/v1.1/V11-WEB-ARCHITECTURE.md`; the technology decisions and scaling triggers are defined in `docs/v1.1/V11-TECHNOLOGY-DECISIONS.md`.
