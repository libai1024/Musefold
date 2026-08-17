---
name: musefold
description: >-
  Generate or edit AI images with the locally installed Musefold desktop app.
  Use for image generation, reference-image edits, Musefold prompt-library
  assets, formal design schemes, or public GitHub visual Skills. Prefer Musefold MCP
  tools when available; otherwise use the musefold CLI. Requires Musefold to be
  running with Automation enabled.
---

<!-- musefold-skill-version: v0.4.0 -->

# Use Musefold for image generation

Musefold is a local-first visual creation app. Credentials stay inside its native UI;
never ask the user to paste account passwords, API keys, tokens, or secrets into chat.

## Choose the connection

1. Inspect the MCP tool catalog. If `musefold_status` is available, call it once and use
   only Musefold tools that are actually present in that catalog.
2. Otherwise, if local commands are available, run `musefold status --json` and
   `musefold help` once. Use only commands and flags shown by that installed CLI.
3. If neither is available, explain that this Agent cannot access the local app. Do not
   claim that an image was generated.

Before any write or spend workflow, read [references/compatibility.md](references/compatibility.md).
Treat `appVersion`, `apiVersion`, optional `capabilities`, the MCP tool catalog, and CLI help
as the authority. A newer Skill may be controlling an older App; never infer a feature from
this Skill's version.

The installed CLI and MCP server automatically start the Musefold desktop app when needed.
**Settings > Automation > Local control plane** must be on.

## Ensure the CLI is installed

Musefold manages the CLI per user and does not require administrator privileges:

- **macOS:** a DMG cannot run a post-install script. The first launch from
  `/Applications` or `~/Applications` installs `musefold` into `~/.local/bin` and adds a
  reversible PATH block for zsh, bash, or fish. Intel and Apple Silicon use the same shim.
- **Windows installer:** NSIS installs `%USERPROFILE%\.musefold\bin\musefold.cmd`, updates
  the HKCU user PATH, and broadcasts the environment change. First launch repairs a
  missing or stale shim, including unpacked/portable builds.
- Existing terminals and Agent hosts do not receive PATH updates. Restart them after
  installation or repair.

If `musefold` is still missing, ask the user to open **Settings > Automation** and choose
**Repair CLI**. For a custom shell, ask them to add the displayed user-level directory to
PATH. Do not use `sudo`, create an ad-hoc system symlink, or modify machine-wide PATH.

Do not use `musefold serve` for a Musefold account. Headless mode does not read the
desktop account session or its secure credentials; it is only for local Providers whose
keys are injected through `MUSEFOLD_PROVIDER_KEY_*` environment variables.

```bash
musefold status --json
```

## Secure setup

With MCP, use `get_setup_status`, then `open_account_setup` or `open_provider_setup` only
when those tools are present and setup is needed. With the CLI, use the following commands
only when `musefold help` lists the relevant command group:

```bash
musefold account status --json
musefold account login
musefold account register
musefold provider setup --name "Provider" --base-url "https://host/v1" --model "model-id"
```

These commands open Musefold's native setup screen. The user enters credentials there.

## Generate images

The user must explicitly request generation before a spend command is run. Their request
authorizes `-y` for that generation only.

```bash
musefold generate -p "<prompt>" -y --json --ratio 1:1 -n 1 -o "<output-directory>"
```

Supported automation ratios are `1:1`, `3:4`, `4:3`, `16:9`, and `9:16`. Optional flags:

```bash
--negative "<negative prompt>"
--ref "<local image path>"                 # repeatable reference image
--ref-history "<history id>"               # repeatable prior Musefold result
--max-cost <points>                         # hard spending ceiling in Musefold points
```

With MCP, call `generate_image` with fields supported by its exposed input schema. It waits
for completion by default in current Apps. Use background mode only when both `wait` and
`wait_for_generation` are exposed: call `generate_image(wait:false)` and then exactly one
`wait_for_generation(jobId)`.

Current Musefold cost and budget values use user-visible points. `1 point = CNY 0.1 =
50,000 managed-account quota units`. Read `costPoints`, `estimatedPoints`, and
`remainingBudgetPoints` as points; never convert a returned point value again and never
treat it as cents. Use CLI `--max-cost` as points only when the installed CLI help describes
it as points. A legacy bare `cost` without `costUnit` has an unknown unit: report it as an
unlabelled legacy value and do not convert it.

CLI `--json` emits NDJSON progress followed by a result object. Present every
`assets[].path` to the user. Do not poll with `get_generation`, and do not retry a failed
spend command automatically.

## Run a public GitHub visual Skill

Use a public GitHub repository URL. Musefold pins the fetched commit and never executes
repository scripts. A configured text AI connection is required.

```bash
musefold skill run "https://github.com/owner/repository" -p "<design request>" -y --json
```

With MCP, call `run_github_skill` only when that tool is present. The current CLI/MCP GitHub
Skill call accepts a text brief but no local reference-image path. If the capability is
missing, or for a GitHub Skill plus source images, ask the user to use the Musefold workbench.

## Reuse Musefold assets

```bash
musefold prompt search "<query>" --json
musefold prompt get <id>
musefold prompt add --title "<title>" --body "<prompt>"
musefold scheme list --json
musefold scheme compile <id> --input "name=value"
musefold scheme run <id> --input "name=value" -y --json
musefold history list --json
```

Compile schemes before generation when the user needs to review the final prompt.
Generation and Skill runs cost money; searches and compilation do not.

## MCP tool map

- Status and setup: `musefold_status`, `get_setup_status`, `select_provider`,
  `open_account_setup`, `open_provider_setup`
- Generation: `list_providers`, `list_provider_models`, `generate_image`,
  `wait_for_generation`, `get_generation`, `cancel_generation`
- Assets: `search_prompts`, `get_prompt`, `save_prompt`, `list_schemes`,
  `get_scheme`, `compile_scheme_prompt`, `list_history`
- Spend workflows: `run_scheme`, `run_github_skill`

This map describes the current release, not guaranteed tools in older Apps. Intersect it
with the actual MCP tool catalog before calling anything.

Always return final image paths/resources and identify the prompt asset, scheme, or GitHub
Skill used. Never expose credentials, silently spend, or repeatedly retry generation.
