---
name: design-md
description: Brand-grade DESIGN.md references (Raycast, Apple, Linear, Warp) for building PromptForge's compact, detail-rich macOS-26 Liquid-Glass / Codex-style desktop UI. Use when building or restyling any renderer UI — chrome, panels, tokens, components.
---

# design-md — PromptForge visual reference

Curated `DESIGN.md` design-system analyses from real products, bundled under `references/`.
Source: [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md)
(Google Stitch `DESIGN.md` format — a plain-text design language an agent reads to generate consistent UI.)

These are analyses of **marketing sites**. Do NOT copy their page-rhythm (96px sections, oversized hero type,
marketing copy). **Translate their material system — surfaces, hairlines, radii, accent discipline, typography —
into desktop-app chrome.** PromptForge is a dense tool, not a landing page.

## When to use

Building or restyling any renderer UI: window chrome, sidebar, panels, cards, popovers, tokens, primitives.

## The brief this serves

PromptForge = Codex-style command center: **dark-default, compact, detail-rich, macOS-26 Liquid Glass**,
cross-platform chrome (mac traffic-lights left / Windows controls right). Single Ember accent (`#f2632c` / `#ff6a3d`).

## Which reference for what

| Reference | Pull this | Ignore this |
|---|---|---|
| `references/raycast.md` | **Primary.** Near-black surface ladder (`#07080a → #0d0d0d → #101111`), hairline `#242728` 1px borders, tight 6–10px card radii, mono/`ss03` type, keycap styling, restrained saturated accents. This IS a macOS command-palette app. | Its marketing hero stripes, 64px display type. |
| `references/apple.md` | **Liquid Glass.** `backdrop-filter: saturate(180%) blur(20px)` frosted bars, translucent chips at ~64% alpha, elevation via surface-color + blur (not shadows), single-accent discipline, full-pill primary actions. | Photography-first layout, museum spacing, one-shadow-on-products rule. |
| `references/linear.md` | **Dense dark panels.** Deepest-dark canvas (`#010102`), charcoal panels (`#0f1011`) with hairline borders, single lavender accent used only on brand/focus/CTA (map to Ember), negative-tracking display, "software-craft" density. | Marketing screenshot framing. |
| `references/warp.md` | Terminal-grade density, mono metadata, keyboard-first affordances. | — |

## How to work (follow in order)

1. **Read the target reference(s)** in `references/` before writing UI. Extract the concrete tokens (hex, radii, border, blur, type scale) — don't paraphrase from memory.
2. **Map, don't copy, into PromptForge's existing token system** — `src/styles/globals.css` (CSS vars) + `tailwind.config.ts`. Never introduce a raw hex in a component; add/adjust a `--var` and its Tailwind alias. The accent stays Ember; borrow *ratios and relationships* (surface ladder steps, hairline alpha, radius scale), not literal brand hex.
3. **Density first.** Controls 24–32px tall, 11–13px text, mono for metadata/counts, hairline separators. If it looks like a landing page, it's wrong.
4. **Liquid Glass discipline (from apple.md):** elevation = layered translucent surface + top specular highlight (`glass-edge`) + backdrop blur, NOT heavy drop shadows. One accent. Continuous corner radii.
5. **Verify by rendering.** A picture is worth 1000 tokens — screenshot each view and critique against the reference before calling it done. Cut anything that reads as generic AI slop.

## Content discipline

Every on-screen string names real information. No fabricated telemetry, no filler mono-caps subtitles, no themed
replacements for standard UI copy ("Save", not "Persist Session"). If removing a label removes no information, cut it.

## Pairs with

The Anthropic `frontend-design` skill (aesthetic direction + process + copy). This skill supplies the concrete
material vocabulary; `frontend-design` supplies the judgment.
