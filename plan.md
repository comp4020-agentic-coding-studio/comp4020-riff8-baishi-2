# Plan: The Scroll for C9, "All at once"

Every point from `prompt.md`, grouped into work phases in the order they
depend on each other. Each phase is roughly one or more commits, and each
commit passes `pnpm check` and `pnpm check:evidence`.

## Goal

Several people can draw at once. Each gets their own strip, everyone sees
everyone else's wet ink live, and it dries in place with no reload. Real-time
means a change reaches every other open session in about 1s.

## Problems being fixed

1. Everyone who loads together is offered the same strip (`zoneStart(count)`).
2. Slower drawers get a 409 and lose their mark.
3. Saving does `location.reload()`, with a white flash.
4. Nobody sees anybody else without reloading.

---

## Phase 1 — Data model

- [ ] Add a `strip` column to `strokes`, backfilled for existing rows (row order).
- [ ] Add `brush` (default `broad`) and `ink` (default `jiao`) columns.
- [ ] Still one table, one SQLite file. No update or delete statements.
- [ ] Per-brush halo spread in `layout.ts`. `zoneBounds` takes a strip index plus a brush.
- [ ] Brush and ink id lists live in one shared module (server and client).

## Phase 2 — Claims (the multi-user decision)

- [ ] Claim endpoint: hands out the **lowest strip that's neither saved nor held**, and returns an anonymous random token.
- [ ] Claim happens on pointerdown or Enter/Space, not on save.
- [ ] Claims live in process memory and expire after ~30–60s. An expired strip goes back into the pool (no permanent holes).
- [ ] A claim carries brush and ink.
- [ ] Save requires a valid token and is accepted only inside **that claim's** strip, using that brush's spread.
- [ ] Unknown brush or ink → 400. Absent → default.
- [ ] Existing validation (path grammar, width, length, bare moveto) stays as strict as now.

## Phase 3 — Real-time transport

- [ ] SSE endpoint with an in-memory subscriber set.
- [ ] Events: mark saved, claim made, claim expired, wet-ink points (all carry brush and ink).
- [ ] Heartbeat comment every ~20s.
- [ ] `Last-Event-ID` (stroke id) catch-up on reconnect.
- [ ] Wet-ink upload: throttled POSTs every ~50–100ms. Points are dropped if they're outside the claim or have no claim. Rate-limited per claim.
- [ ] Fits in 256 MB. `auto_stop_machines` unchanged.

## Phase 4 — Client drawing flow

- [ ] Remove `location.reload()`. Your mark dries in place.
- [ ] Status after saving: "yours is mark 68. It stays." Then the page closes for drawing (one mark per visit).
- [ ] Other people's wet ink: their chosen ink at ~45% opacity, soft edge, no halo. Dries to full strength with the halo fading in (~400ms).
- [ ] A claimed but empty strip shows a faint `--wet` wash.
- [ ] Wet ink is never saved and never shown to later arrivals.
- [ ] Presence = wet ink only. No cursors, avatars, names or online counter.
- [ ] Keyboard path claims, uses the chosen brush and ink, and dries like a pointer mark.
- [ ] If the claim expired while away, say so before drawing.

## Phase 5 — View behaviour and phones

- [ ] At the right-hand end: follow new marks. Scrolled back: stay put and show a "N new marks →" button.
- [ ] Never move the canvas mid-stroke.
- [ ] 375px: blank strip visible on load, a drag in the strip draws, a swipe outside it scrolls.
- [ ] No JS: `/` still 200 with every mark (with its own brush and ink) rendered server-side.

## Phase 6 — Brushes and inks

- [ ] Inks (4 ink tones and 3 pigments, none red):
  - `jiao` `#1d1b19` · `nong` `#3a3631` · `zhong` `#5e5850` · `dan` `#8f877c`
  - `indigo` `#2f4f6f` · `ochre` `#9a5b2e` · `malachite` `#3e7a64`
- [ ] Halo = the mark's own ink at the current `--ink-soft` alpha.
- [ ] Brushes:
  - `broad`: today's brush, width 3–14 by speed (default)
  - `fine`: width ~1.5–5, small halo
  - `dry`: streaky "flying white", filter or mask seeded by stroke id (same for every viewer)
  - `wash`: very wide, low opacity, big soft bleed
- [ ] Tray below the scroll: two real radio groups (`fieldset`/`legend`, arrow keys), a sample stroke preview.
- [ ] Choice is free until the brush touches down, then locked (one mark = one brush and one ink).
- [ ] Tray hidden without JS.
- [ ] Existing marks look exactly as before (`broad` + `jiao`).

## Phase 7 — Page design (mounted handscroll)

- [ ] Tokens on `:root`:
  - `--mount` `#1e2a31` · `--paper` `#f3ecdf` · `--ink` `#1d1b19` · `--wet` `#5b6b78` · `--seal` `#b5332a`
  - Text on mount `#e8e1d3`, secondary text `#a9b4ad`
  - Remove the brown `--accent`/`--link`
- [ ] Cinnabar is rare: the seal, focus rings, the draw-here prompt. Never small text on the mount.
- [ ] One theme. Dark mode only dims the paper (~`#e4dccd`), never inverts it.
- [ ] Scroll full viewport width, taller on desktop, soft drop shadow.
- [ ] Paper grain via one `feTurbulence` filter (no images).
- [ ] Wooden roller at the right end, slides ~300ms when the scroll grows. Silk border and title slip at the left end.
- [ ] Seal on your own mark: small cinnabar square with the mark number, client-only, never saved, quick stamp (~150ms).
- [ ] Draw-here strip: brighter paper patch with italic cinnabar text (no dashed box).
- [ ] Type: system serif stack, title in small caps and tracked. Museum-label caption under the scroll ("67 marks, since … Two people are drawing now."), with the `/readme/` link in it.
- [ ] `/readme/`: paper column on the mount, ~65ch, same palette.
- [ ] Motion only for drying, roller and seal. Nothing idle or looping. Reduced motion snaps to the end state.
- [ ] Avoid: gradients, card chrome, emoji, icon fonts, sliding toasts, a SaaS look, pre-drawn motifs.
- [ ] New `favicon.svg`: paper, ink stroke, tiny seal.
- [ ] Check at 375px and 1440px. AA contrast, SVG text measured by hand.

## Phase 8 — Tests (`spec/scroll.test.ts`)

- [ ] Keep: persistence, validation, no delete, no painting outside your strip (rewritten around claims).
- [ ] Two back-to-back claims → different strips, both saves succeed.
- [ ] Save outside your claim, with no token or with someone else's token → refused.
- [ ] Second SSE client gets a new mark within ~1s.
- [ ] Valid wet ink reaches another SSE client. Out-of-claim points don't.
- [ ] Expired claim's strip goes to the next claimer.
- [ ] Unknown brush or ink → 400. Saved brush and ink appear on a no-JS `GET /`. Missing → `broad`/`jiao`.
- [ ] `wash` mark hugging the edge is refused where `fine` would fit.
- [ ] `spec/invariants.test.ts` unchanged and green.

## Phase 9 — Writing it down

- [ ] `docs/adr/0001-concurrent-drawers.md`: context, decision, alternatives (keep the 409 plus live updates; shared overlapping strip; first-come queue), costs (in-memory claims lost on restart, brief gaps, timeout tuning, wet ink as the only presence), tied to the README's "good".
- [ ] Update `README.md`: real-time is here, no more stale-strip refusal, brushes and inks.
- [ ] Short C9 section in `PROCESS.md`. No reflection.

## Phase 10 — Ship and verify

- [ ] Push to `main`. CI deploys to Fly.
- [ ] On the **live** URL, two windows: wet ink follows the brush in the neighbouring strip, dries on lift, both marks are kept, no reloads.
- [ ] Delete `prompt.md` in the last commit.

## Never

- Update or delete a saved mark; undo; accounts; likes; gallery; moderation.
- A second service, a second table, or a client framework.
- More brushes or inks, or a free colour picker.
- Touching the top block of `CLAUDE.md`.
