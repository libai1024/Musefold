# Musefold App compatibility

Use capability detection before version comparison. Version strings are diagnostic context,
not proof that a command, field, or MCP tool exists.

## Detection order

1. Treat the MCP tool catalog and each tool's input schema as authoritative.
2. Read `musefold_status`. Respect explicit `capabilities`; treat absent capability fields as
   unknown, not `true`.
3. For CLI fallback, read `musefold status --json` and `musefold help`. Do not pass a command
   or flag that the installed CLI does not advertise.
4. If status omits `appVersion`, `apiVersion`, or `capabilities`, continue only with the
   baseline commands visibly available. Explain that advanced features require a newer App.

## Safe fallbacks

| Requested behavior | Preferred capability | Fallback when absent |
| --- | --- | --- |
| Account or Provider setup | MCP setup tools or CLI `account`/`provider setup` | Ask the user to configure it in the App UI. Never collect credentials in chat. |
| Reference image | `referenceImagePaths` or CLI `--ref` | Ask the user to attach and generate in the App workbench. |
| Reuse history image | `referenceHistoryIds` or CLI `--ref-history` | Resolve a local asset path from history only if the exposed tools return one; otherwise use the App. |
| Background completion | `wait_for_generation` or a CLI command that waits | Prefer the foreground generation call. If an old MCP returns only a `jobId`, use `get_generation` at a bounded interval and stop at a terminal state. |
| Formal scheme | scheme MCP tools or CLI `scheme` group | Ask the user to run the scheme in the App. Do not flatten an unknown scheme into an invented prompt. |
| GitHub visual Skill | `run_github_skill` or CLI `skill run` | Ask the user to import/run it in the App workbench. |
| Point cost | `costPoints`, `estimatedPoints`, `remainingBudgetPoints`, or `costUnit: point` | Report an unlabelled legacy `cost` as an unknown-unit value. Never guess a conversion. |

## Unsupported calls

- Do not call a missing MCP tool or add an unadvertised CLI flag.
- Do not automatically retry a spend call after `UNKNOWN_TOOL`, `NOT_FOUND`, invalid-argument,
  or unsupported-capability errors. A request may already have reached the App.
- If a rejected request clearly returned no `jobId` and no confirmation was accepted, explain
  the compatible alternative and obtain fresh user authorization before another spend call.
- Never use a new field with an old App merely because the field appears in this Skill.

## Current capability fields

Current Apps may report `generation`, `schemes`, `skills`, `setup`, `generationWait`,
`referenceImages`, `historyReferences`, `pointCosts`, and `githubSkillReferenceImages`.
Unknown future fields may be ignored. Missing fields remain unknown and must not enable a
workflow by themselves.
