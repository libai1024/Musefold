# Musefold Design System

<!-- impeccable:design-schema 1 -->

## Visual World

Musefold uses a quiet creative-tool language called Graphite / Ember. Stable porcelain or graphite surfaces carry the work; a single ember accent marks creation, selection, and active progress. The interface should feel like a precise studio instrument rather than a marketing site.

## Surface Strategy

- Desktop and Web share identity, tokens, typography, icon language, and core prompt/generation component behavior.
- Desktop keeps its dense multi-panel workflows. Web v1.1 uses a task rail, a broad creation sheet, and a compact prompt recall strip that collapses into a single-column flow on phones.
- The actual product experience is always the first screen. Do not place a landing-page hero inside the app shell.

## Color

- Light ground: `#f6f6f4`; elevated surface: `#ffffff`; sidebar: `#f1f1ee`.
- Primary ink: `#202124`; secondary ink: `#55575c`; quiet ink: `#74777c`.
- Ember: `#d6653f`; hover: `#bc5535`; soft selection: `rgba(214, 101, 63, 0.12)`.
- Success: `#2a7b4a`; warning: `#a96d1d`; danger: `#b54935`; info: `#3f739e`.
- Dark mode may use the existing desktop graphite scale, but light mode is the Web v1.1 launch default.
- Do not use gradients, decorative glows, color blobs, glass cards, or a palette dominated by blue/purple.

## Typography

- Use the native UI stack: `SF Pro Text`, `Segoe UI Variable`, `PingFang SC`, system sans-serif.
- Keep letter spacing at `0`.
- App labels use 12-14px; body and inputs use 14-16px; page headings use 20-24px.
- Use tabular figures for quota, dimensions, and job progress.

## Shape And Spacing

- Use a 4px spacing base with primary rhythm at 8px.
- Dense rows use 6px radius, tools and individual items use 8px, dialogs may use 12px.
- Do not use pills except compact statuses or true segmented controls.
- Touch targets are at least 44px on mobile; desktop icon controls are at least 32px.
- Sections remain unframed. Cards are reserved for individual prompt/result items and framed tools.

## Interaction

- Use Lucide icons for familiar actions; icon-only actions require accessible names and tooltips.
- Every async action has loading, success, empty, recoverable error, and disabled states.
- A generation starts only from an explicit button press and preserves an immutable prompt/request snapshot.
- Respect `prefers-reduced-motion`; motion is limited to short state transitions and progress feedback.
- Focus is always visible, keyboard navigation follows DOM order, and mobile layouts never require hover.

## Web V1.1 Composition

- Desktop: fixed task rail, flexible main work area, optional prompt recall rail.
- Mobile: left overlay drawer (functions + conversations, account at the bottom), a single work column with the conversation topic and the shared composer; search and remaining credits stay in the top-right.
- The generation result uses a stable `aspect-ratio` container so loading and status changes cannot move the composer.
- Prompt library uses rows for scanning and comparison; details open as a page or drawer rather than a nested card.
