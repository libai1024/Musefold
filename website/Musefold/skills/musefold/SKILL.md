---
name: musefold
description: >-
  Generate or edit AI images with the locally installed Musefold desktop app.
  Use for image generation, reference-image edits, Musefold prompt-library
  assets, formal design schemes, or public GitHub visual Skills. Prefer Musefold MCP
  tools when available; otherwise use the musefold CLI. Requires Musefold to be
  running with Automation enabled.
---

# Use Musefold for image generation

Musefold is a local-first visual creation app. Credentials stay inside its native UI;
never ask the user to paste account passwords, API keys, tokens, or secrets into chat.

## Choose the connection

1. If Musefold MCP tools such as `musefold_status` and `generate_image` are available,
   call `musefold_status` once and use MCP.
2. Otherwise, if local commands are available, run `musefold status --json` once and use
   the CLI.
3. If neither is available, explain that this Agent cannot access the local app. Do not
   claim that an image was generated.

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
when setup is needed. With the CLI, use:

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

With MCP, call `generate_image` with the equivalent fields. It waits for completion by
default and returns image resources. For deliberate background work, call
`generate_image(wait:false)` and then exactly one `wait_for_generation(jobId)`.

All Musefold cost and budget values use user-visible points. `1 point = CNY 0.1 = 50,000
managed-account quota units`. Read `costPoints`, `estimatedPoints`, and
`remainingBudgetPoints` as points; never convert a returned point value again and never
treat it as cents. CLI `--max-cost` is also expressed in points.

CLI `--json` emits NDJSON progress followed by a result object. Present every
`assets[].path` to the user. Do not poll with `get_generation`, and do not retry a failed
spend command automatically.

## Run a public GitHub visual Skill

Use a public GitHub repository URL. Musefold pins the fetched commit and never executes
repository scripts. A configured text AI connection is required.

```bash
musefold skill run "https://github.com/owner/repository" -p "<design request>" -y --json
```

With MCP, call `run_github_skill`. The CLI/MCP GitHub Skill call currently accepts a text
brief but no local reference-image path. For a GitHub Skill plus source images, ask the
user to paste the GitHub URL into the Musefold workbench, attach the images there, and run
the prepared Skill in the app.

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

Always return final image paths/resources and identify the prompt asset, scheme, or GitHub
Skill used. Never expose credentials, silently spend, or repeatedly retry generation.
