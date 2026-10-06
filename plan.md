# Plan: The Scroll for C9, "All at once"

Every point from `prompt.md`, grouped into work phases in the order they
depend on each other. Each phase is roughly one or more commits, and each
commit passes `pnpm check` and `pnpm check:evidence`.

## Goal

Several people can paint at once. Each gets their own strip and can lay down
several strokes, everyone sees everyone else's wet ink live, and the whole
mark dries in place when its painter presses Publish, with no reload. Real-time
means a change reaches every other open session in about 1s.

## Problems being fixed

1. Everyone who loads together is offered the same strip (`zoneStart(count)`).
2. Slower drawers get a 409 and lose their mark.
3. Saving does `location.reload()`, with a white flash.
4. Nobody sees anybody else without reloading.

---

## Phase 1 — Data model

- [ ] Add a `strip` column to `strokes`, backfilled for existing rows (row order).
- [ ] One row per **published mark** (so "N marks" still counts visits). Strokes stored in that row, each with `d`, width, brush and ink (a JSON column is fine).
- [ ] Existing rows = one-stroke marks, `broad`/`jiao`, rendered exactly as now.
- [ ] Publish writes all strokes in one statement (all or nothing).
- [ ] Still one table, one SQLite file. No update or delete statements.
- [ ] Per-brush halo spread in `layout.ts`. `zoneBounds` takes a strip index plus a brush.
- [ ] Brush and ink id lists live in one shared module (server and client).

## Phase 2 — Claims (the multi-user decision)

- [ ] Claim endpoint: hands out the **lowest strip that's neither saved nor held**, and returns an anonymous random token.
- [ ] Claim happens on pointerdown or Enter/Space, not on save.
- [ ] Claims live in process memory and expire after ~90s with no new stroke (each stroke resets the clock). An expired strip goes back into the pool (no permanent holes).
- [ ] Wet strokes are held in memory with the claim. The claim holder can lift (remove) one of their own wet strokes by token, and nothing else can.
- [ ] Publish requires a valid token. Every stroke must sit inside **that claim's** strip, using its own brush's spread.
- [ ] Up to 24 strokes per mark, plus a total request size cap. Empty publish → refused.
- [ ] Unknown brush or ink → 400. Absent → default.
- [ ] Existing validation (path grammar, width, length, bare moveto) stays as strict as now.

## Phase 3 — Real-time transport

- [ ] SSE endpoint with an in-memory subscriber set.
- [ ] Events: mark published, claim made, claim expired, wet-ink points (all carry brush and ink).
- [ ] Heartbeat comment every ~20s.
- [ ] `Last-Event-ID` (stroke id) catch-up on reconnect.
- [ ] Wet-ink upload: throttled POSTs every ~50–100ms. Points are dropped if they're outside the claim or have no claim. Rate-limited per claim.
- [ ] Fits in 256 MB. `auto_stop_machines` unchanged.

## Phase 4 — Client drawing flow

- [ ] Remove `location.reload()`. Your mark dries in place.
- [ ] Status after publishing: "yours is mark 68. It stays." Then the page closes for drawing (one mark per visit).
- [ ] Several strokes per mark.
- [ ] Eraser tool in the tray: tap or drag over your own wet stroke to lift the whole stroke (not pixels). A "Lift last stroke" button too. Lifts disappear live for everyone and count as claim activity.
- [ ] The eraser never touches published marks or other people's wet strokes.
- [ ] Publish `<button>` in the tray: disabled until 1+ stroke, labelled "Publish: no more erasing after this", disabled again if every stroke is lifted, no confirm dialog. On press, the whole mark dries and the seal stamps.
- [ ] Lapse warning ~15s before the claim expires. A lapsed draft fades for everyone and is never auto-published.
- [ ] Other people's wet ink: each stroke's ink at ~45% opacity, soft edge, no halo. On publish all strokes dry together, with the halo fading in (~400ms).
- [ ] A claimed but empty strip shows a faint `--wet` wash.
- [ ] Wet ink is never saved and never shown to later arrivals.
- [ ] Presence = wet ink only. No cursors, avatars, names or online counter.
- [ ] Keyboard: arrow keys move a brush-tip cursor inside the strip, Enter/Space leaves a dot there (or lifts the stroke under the cursor when the eraser is selected), Tab reaches the tray, "Lift last stroke" and Publish. `aria-live` announces the stroke count and the published state.
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
- [ ] Brush and ink can change **between** strokes. Each stroke is locked to what it started with.
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
- [ ] Multi-stroke publish = one row: count +1, every stroke on a no-JS `GET /`.
- [ ] One bad stroke refuses the whole mark, and nothing is written.
- [ ] Over the stroke cap, or empty → refused.
- [ ] Own wet stroke can be lifted, and the lift reaches another SSE client. Wrong or missing token, or someone else's stroke → refused.
- [ ] After publishing, lift is refused and the mark is still on `GET /`.
- [ ] A lapsed claim's wet strokes are never saved.
- [ ] `spec/invariants.test.ts` unchanged and green.

## Phase 9 — Writing it down

- [ ] `docs/adr/0001-concurrent-drawers.md`: context, decision, alternatives (keep the 409 plus live updates; shared overlapping strip; first-come queue), rejected auto-publish on lapse; wet-only eraser (kinder drafting vs. the scroll no longer recording hesitations); costs (in-memory claims and drafts lost on restart, brief gaps, timeout tuning, wet ink as the only presence), tied to the README's "good".
- [ ] Update `README.md`: real-time is here, no more stale-strip refusal, multi-stroke marks with a wet-ink eraser and Publish; rewrite "Nobody can undo it" as "final once it's dry"; brushes and inks.
- [ ] Short C9 section in `PROCESS.md`. No reflection.

## Phase 10 — Ship and verify

- [ ] Push to `main`. CI deploys to Fly.
- [ ] On the **live** URL, two windows: paint several strokes (changing ink) and see them wet in the neighbouring strip. Publish → the whole mark dries in both windows and the seal stamps. Both marks are kept, no reloads.
- [ ] Delete `prompt.md` in the last commit.

## Never

- Update or delete a saved mark; erasing a published mark or someone else's wet stroke; a pixel eraser; accounts; likes; gallery; moderation.
- A second service, a second table, or a client framework.
- More brushes or inks, or a free colour picker.
- Touching the top block of `CLAUDE.md`.
