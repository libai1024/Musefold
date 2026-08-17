# Musefold Landing Surface Override

The generated master system is a searchable starting point, not the brand authority. The existing Musefold brand plan in `docs/v0.3/MUSEFOLD-BRAND-PLAN.md` wins for identity, copy, palette, and product claims.

## Direction

- Use the existing app shell as the website frame: a 244px sidebar, a 52px title bar, compact 13px UI type, rounded-md controls, active navigation rows, and a scrollable work area.
- Keep the product legible before the story becomes expressive. The first viewport must show the app navigation, title bar, Musefold promise, a real workbench capture, and a path to downloads.
- Reuse the app's Graphite/Porcelain surfaces, active row states, and Ember action color. No gradients, neon effects, generic AI imagery, fake metrics, or fabricated product UI.
- Use real captures from `generated/` and the existing mark from `resources/icon.png`.

## Tokens

| Token | Value | Use |
|---|---|---|
| Ember 500 | `#D6653F` | Primary action and story marker |
| Ember 400 | `#EF7A52` | Dark-surface emphasis |
| Graphite 950 | `#18191B` | Hero, proof, and footer surfaces |
| Graphite 900 | `#202124` | Framed product captures |
| Porcelain | `#F1EEE8` | Paper surfaces and light text |

## Content

- Primary Chinese promise: `让灵感成为图像。`
- Supporting line: `把一张参考图、一段文字或一个还说不清楚的方向，放到同一张可靠的创作桌上。`
- Product proof: collect fragments, shape reusable design schemes, reveal a direction, and keep the result.
- Download labels must remain honest until signed artifacts are published. The local preview uses `待审核接入` and does not link to an unpublished binary.

## Acceptance

- Verify 375px, 390px, 768px, 1024px, and 1440px widths.
- No horizontal scroll, hidden focus, or content beneath the sticky header.
- Respect `prefers-reduced-motion` and keep all product imagery local.
