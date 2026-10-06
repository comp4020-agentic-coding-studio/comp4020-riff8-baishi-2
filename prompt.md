# Pod 2's brief: make The Scroll feel like a room full of people with brushes

You are running unattended. Nobody will answer questions, so where this
prompt leaves something open, decide it, write down why (in the ADR below),
and keep going. Finish in one run, leave `main` green and deployed, and
delete this file in your last commit.

## Where the app is, and what's wrong with it today

Read `README.md`, `CLAUDE.md`, `src/` and `spec/` first. The Scroll is a
shared ink scroll: each visit gets one mark in the blank strip at the right
end, and no mark is ever erased or painted over. The idea is good. What
it's like to use is not, and next crit (C9, "All at once") is about exactly
the moment where it fails worst: **several people opening it at the same
moment.**

What happens right now when four pod members open it together:

1. All four are offered **the same** blank strip (`zoneStart(count)`).
2. The first to lift their brush wins. The other three, having already
   drawn, get a 409: "someone else drew in this strip first. Reload". Their
   mark is thrown away. The README is right that ink-wash tolerates the
   mark that goes wrong, but here the mark that went *right* gets lost, and
   only because somebody else was quicker.
3. The winner's page runs `location.reload()`, a full white flash, and only
   then do they see their own mark.
4. Nobody sees anybody else. The other people in the room might as well be
   on a different site until they reload.

Fix those four things and the C9 brief is met. Real-time is required:
another open session sees a change within about a second, with no reload.

## The multi-user decision: two people drawing at once

The C9 brief asks you to pick **one** multi-user question and decide it. For
The Scroll it should be **"what happens when two people draw at the same
time"**, because that's where the current app breaks. Our answer, which you
should build and then defend in an ADR:

**Every drawer gets their own strip, and everyone watches the ink go down
while it's still wet.**

- **Claim a strip when the brush first goes down** (pointerdown, or
  Enter/Space). Don't wait for the save. The server hands out the lowest
  strip nobody has saved into and nobody currently holds. Two people who
  start together get two neighbouring strips, so neither is ever refused
  for being slow. A claim ends when its mark is published, or after a
  stretch of inactivity (around 90s with no new stroke, your call) if the
  drawer walks off. Each stroke resets the clock. An expired strip goes
  back into the pool, so the scroll gets no permanent holes.
- **The server enforces the claim.** A save is accepted only inside the
  strip that visitor claimed. The halo and bounds rules in
  `zoneBounds`/`strokes.ts` stay exactly as strict as they are now, just
  checked against the claimed strip rather than `count`. Saved marks keep
  their absolute coordinates, so a mark's strip has to be known for every
  saved row. A column on the existing `strokes` table is fine, backfilled
  for the rows already there. A second table, or anything outside SQLite,
  is not (see `CLAUDE.md`). Claims can live in the server process's memory:
  it's one machine, and a claim lost on restart costs one in-progress mark.
  Say that cost in the ADR.
- **Wet ink is the presence indicator.** While someone is drawing, everyone
  else sees their strokes appear live in that person's strip, lighter and
  softer, with no halo: ink that hasn't dried. When the mark is published,
  all of its strokes *dry* together. It darkens into the normal ink with its soft halo, through a
  short transition (a few hundred ms; respect
  `prefers-reduced-motion`). A strip that's been claimed but not yet drawn
  in can show a faint "someone's here" wash. Those are the only signals of
  presence: no cursors, no avatars, no names, no "3 people online"
  counter. The README's case for small-on-purpose is why. Wet ink is
  never saved and never shown to a visitor who arrives after it's gone.
- **Your own mark dries in place.** Drop `location.reload()`. After
  publishing, your strokes darken where they are, the status line says
  something like "yours is mark 68. It stays.", and your page closes for
  drawing (still one mark per visit). The scroll keeps updating live
  around it.

## Several strokes, then Publish

Today a mark is one stroke: lift the brush and it's saved. Change that.
**A mark is everything you paint in your strip, made final when you press
Publish.** One visit still gets one mark, but a mark can now be a bamboo
stalk, a character, or a small landscape, not just a single gesture.

- **An eraser for wet ink, and only wet ink.** Until you publish, you can
  lift any of **your own** strokes, like blotting wet ink off the paper
  before it sets. The eraser is a tool in the tray beside the brushes.
  With it selected, tapping or dragging over one of your wet strokes lifts
  that **whole stroke**. Don't build a pixel eraser: a stroke is the unit
  that gets stored and validated, and partial strokes would need masks the
  server can't check. Add a "Lift last stroke" button next to it for
  keyboard users and quick fixes. A lifted stroke disappears live from
  everyone else's screen too, and erasing counts as activity for the
  claim timeout.
- **Once published, it's dry forever.** The eraser never touches a
  published mark, yours or anyone's, and there's still no route that can.
  It can't reach other people's wet strokes either, because it only knows
  the strokes held under your own claim token. The line the app draws
  moves from "every stroke is final" to "**the mark is final once it's
  dry**", and Publish is now the moment of commitment. Rewrite the
  README's "Nobody can undo it, including you" to say exactly that, and
  put the trade-off in the ADR (an eraser makes drafting kinder, but the
  scroll no longer records the hesitations). Keep the button label honest
  about it: "Publish: no more erasing after this".
- **The Publish button** is a real `<button>` in the tray. It's disabled
  until there's at least one stroke, and its label says what it does, for
  example "Publish: no more erasing after this". It goes disabled again if every stroke has been lifted. No confirmation dialog. Pressing it sends
  every stroke in one request, the server writes them in one statement
  (all or nothing), the whole mark dries, and the seal stamps. Stamping
  the seal is the act of publishing, like a painter signing a finished
  scroll.
- **Until you publish, nothing is saved.** Your strokes are wet ink:
  everyone sees them live, but they're held only in the server's memory
  with your claim. If the claim lapses (about 90s with no new stroke), the
  wet strokes fade from everyone's screen and the strip goes back into the
  pool. Warn the drawer plainly about 15s before that happens ("your ink
  dries in 15s unless you keep painting or publish"). Should a lapsed
  draft be published automatically instead? No. Publishing is the
  visitor's decision. Note the alternative in the ADR.
- **A limit on strokes.** Up to 24 strokes per mark, each validated
  exactly as a single stroke is today (grammar, width, bounds, per-brush
  halo), with a total size cap on the request. The strip's bounds already
  stop a mark spreading. The stroke cap stops one visitor holding a strip
  forever with ten thousand dots.
- **Brush and ink per stroke.** Change brush or ink freely *between*
  strokes. Each stroke is locked to the brush and ink it started with.
  Mixing ink tones in one mark is exactly what Chinese ink painting does.
- **Keyboard.** A dot at the centre isn't enough once a mark can be
  several strokes. When the strip has focus, arrow keys move a visible
  brush-tip cursor around the strip (staying inside the bounds), and
  Enter/Space leaves a dot there (or, with the eraser selected, lifts the wet stroke under the cursor). Tab reaches the tray, "Lift last stroke" and Publish. Tell
  screen readers how many strokes are down and whether the mark is
  published (`aria-live`).
- **Storage.** Still one table, still one row per published mark, so "N
  marks so far" keeps meaning visits. Store the mark's strokes, each with
  its own `d`, width, brush and ink, in that row (a JSON column is fine).
  Existing rows are one-stroke marks and render exactly as they do now.
  The server-rendered `/` draws every stroke of every mark without
  JavaScript.

The alternatives the pod argued against, which the ADR should weigh
honestly and say what our choice costs: keep the 409 and just push live
updates so people at least see the strip has moved; a shared strip where
concurrent marks layer on top of each other (rejected: overpainting is
erasing, see `CLAUDE.md`); first-come queueing ("you're next, wait").

## Transport, and other things to get right

- **Server-sent events** from one Astro endpoint, keeping a set of
  subscribers in memory. The stack has no WebSocket server, there's one
  process on one machine, and the traffic is mostly server-to-client.
  Wet-ink points go up as small, throttled POSTs (batching around every
  50–100ms is plenty) and are fanned out over SSE. Send a heartbeat comment
  every ~20s so Fly's proxy doesn't drop idle streams. The app has to fit in
  256 MB and `auto_stop_machines` stays as it is.
- **Validate wet ink like real ink.** Points outside the claim, or from a
  visitor who holds no claim, are dropped. Rate-limit per claim so one tab
  can't flood everyone. The client is never trusted (`CLAUDE.md`). A claim
  needs some anonymous token so the server knows whose it is: a random id
  handed back from the claim request is enough. No cookies-as-login, no
  accounts.
- **Don't yank anyone's view.** When new marks arrive, the scroll grows. If
  the viewer is already at the right-hand end, follow along. If they've
  scrolled back to look at old marks, leave them there and show a small
  "2 new marks →" button that takes them to the end. Never move the canvas
  while the viewer is mid-stroke.
- **Reconnects.** If the SSE stream drops (phone sleeps, wifi blips),
  reconnect and catch up on anything saved meanwhile (`Last-Event-ID` with
  the stroke id works well) without reloading. If your claim expired while
  you were away, say so plainly before you draw rather than after.
- **Without JavaScript, nothing changes.** `/` still renders every saved
  mark server-side with a 200. Live updates and drawing are progressive
  enhancement. The keyboard path (Enter/Space leaves a dot) has to claim a
  strip and dry exactly like a pointer mark does.
- **Phones.** Pod members will open this on their phones at the crit. Check
  it at a 375px-wide viewport: the blank strip is visible on load without
  hunting for it, a drag in the strip draws rather than scrolls, and a
  horizontal swipe outside it still scrolls.

## Page design: a mounted handscroll, unrolled on a table

At the moment the page is a beige box with a heading over it. It should
look like the thing the README describes: an East Asian ink handscroll
(think a Song-dynasty landscape scroll, unrolled right to left as it
grows), mounted on dark silk and laid on a table. The scroll is the only
object that matters on the page, and everything else steps back from it.

**Palette.** Five colours, defined as tokens on `:root` in
`src/styles/global.css` and used everywhere. The only other colours are
the visitors' inks (see "Brushes and inks" below), which only ever appear
as ink on paper, never on UI. These contrast ratios have been checked:

| token          | value                    | role |
|----------------|--------------------------|------|
| `--mount`      | `#1e2a31` deep indigo silk | page background, the silk mounting around the scroll |
| `--paper`      | `#f3ecdf` warm xuan paper  | the scroll itself |
| `--ink`        | `#1d1b19` sumi black       | dry marks (14.6:1 on paper) |
| `--wet`        | `#5b6b78` blue-grey        | wet ink still being drawn, at reduced opacity (fresh sumi reads slightly blue) |
| `--seal`       | `#b5332a` cinnabar red     | the one accent: the seal stamp, focus rings, the draw-here prompt (5.2:1 on paper) |

Text on the mount is `#e8e1d3` (11.3:1), with `#a9b4ad` for secondary text
(6.9:1). Cinnabar on the mount only reaches 4.4:1, so use it there only
for large or non-text things. Red is **rare on purpose**: if more than
one or two things on screen are red, it has stopped meaning anything. The
existing brown `--accent`/`--link` go away.

**One theme, not two.** The page is already dark silk around light paper,
so drop the separate light/dark switch. Under
`prefers-color-scheme: dark`, dim the paper slightly (around `#e4dccd`) so
it doesn't glare at night. Never invert it to dark paper with light ink:
ink is black.

**The objects.**
- *The scroll* runs the full width of the viewport, edge to edge, not
  inside a 60rem column. On desktop it's as tall as fits comfortably (the
  SVG viewBox can scale, and coordinates stay as they are). A soft drop
  shadow lifts it off the silk.
- *Paper grain* comes from one SVG `feTurbulence` filter laid over the
  paper at low opacity. No image files.
- *A wooden roller* sits at the right-hand end, just past the blank strip.
  It's a plain rounded bar in a dark wood brown, with the next paper
  "unrolling" from it. It's where new paper comes from, so when a strip is
  saved and the scroll grows, the roller slides right with a short ease.
  The left end gets a thin silk border with a title slip, as on a real
  scroll.
- *The seal.* When your own mark dries, a small square cinnabar seal
  stamps down in the corner of your strip, showing your mark's number
  (e.g. "六十八" or just "68"; pick one and keep it). It's drawn by the
  client, on your page only, and never saved. It's how the page says
  "this one is yours" without accounts. Other people's marks get no seal.
- *Wet ink*: the drawer's chosen ink at about 45% opacity, with no halo,
  and the stroke edge slightly soft (a light blur filter is fine). Drying
  is a transition to full strength, with the halo fading in. A claimed
  but empty strip gets a very faint `--wet` wash.
- *The draw-here strip*: drop the dashed box. Use a slightly brighter
  patch of paper with the prompt in italic cinnabar, as if it were an
  invitation brushed onto the paper.

**Type.** Keep the existing system serif stack (Iowan / Palatino /
Georgia): no web fonts, no extra requests. Set the title in small caps
with generous letter-spacing, the way a colophon is set. Header and status
text are quiet: secondary colour, small size, set on the mount *beneath*
the scroll like a museum label ("67 marks, since 29 September 2026. Two
people are drawing now." The second sentence can come from claims; that's
not a presence counter, just the label noticing wet ink). The link to
`/readme/` lives in that label. Give `/readme/` the same treatment: paper
column on the silk mount, comfortable measure (~65ch), the same palette.

**Motion.** Slow and few: ink drying (~400ms), the roller sliding (~300ms),
the seal stamping (a quick scale from 1.15 to 1 with a slight rotation,
~150ms). Nothing loops or bounces, and nothing animates while idle. Under
`prefers-reduced-motion`, everything snaps straight to its end state.

**What to avoid.** Gradients on UI, rounded "card" chrome, emoji, icon
fonts, toasts that slide in, and anything that looks like a SaaS
dashboard. Don't add a dark-ink-on-dark-paper mode. Don't decorate the
scroll with pre-drawn mountains or motifs: the only ink on the paper is
visitors' ink. Update `public/favicon.svg` to match (paper square, ink
stroke, tiny seal).

Check the finished page at 375px and 1440px wide, and keep any contrast
you introduce at or above WCAG AA. `PROCESS.md` already notes that axe
can't measure SVG text contrast, so measure that by hand.

## Brushes and inks: choice, inside the tradition

Visitors choose a brush and an ink before they draw. The choice comes
from Chinese ink painting, not a paint app. There's no colour picker, no
RGB and no hex input, only a short, fixed set. A scroll where every
mark uses a different arbitrary colour stops reading as one piece. A
small set keeps it whole and still gives each mark a voice.

**Inks.** Ink painting says "ink has five colours" (墨分五色): one black
ground to different strengths. Offer four of those tones and three
mineral pigments, seven in all. Each has been checked to show against
`--paper` (3:1 or better, the bar for graphics):

| id       | name              | value     | on paper |
|----------|-------------------|-----------|----------|
| `jiao`   | scorched ink 焦墨 | `#1d1b19` | 14.6:1 (the default: what every mark so far is) |
| `nong`   | dense ink 浓墨    | `#3a3631` | 10.2:1 |
| `zhong`  | heavy ink 重墨    | `#5e5850` | 6.0:1 |
| `dan`    | light ink 淡墨    | `#8f877c` | 3.0:1 |
| `indigo` | indigo 花青       | `#2f4f6f` | 7.2:1 |
| `ochre`  | ochre 赭石        | `#9a5b2e` | 4.6:1 |
| `malachite` | malachite 石绿 | `#3e7a64` | 4.3:1 |

**Cinnabar is not an ink.** It stays reserved for the seal, so red on the
scroll always means "yours". The halo of each mark is its own ink at the
same low alpha the current `--ink-soft` uses.

**Brushes.** Four, each a different way of rendering the same one-path
mark:

| id      | name                 | feel |
|---------|----------------------|------|
| `broad` | soft goat-hair 羊毫  | today's brush, unchanged: width 3–14 by speed. The default, and what every existing mark is |
| `fine`  | wolf-hair liner 狼毫 | thin and crisp, width about 1.5–5, small halo |
| `dry`   | flying white 飞白    | broad and streaky, with paper showing through the stroke. Render it with an SVG filter or mask seeded from the stroke id, so every viewer sees exactly the same streaks |
| `wash`  | wet wash 泼墨        | very wide, low opacity, big soft bleed: for shading rather than line |

A brush with a wider halo reaches further, so `zoneBounds` and the server
check must use **that brush's** spread, not the global `SOFT_SPREAD`. The
"never paint over a neighbour" promise holds per brush, and the
validation-test pattern from crit 8 should cover the widest one.

**The tray.** Below the scroll, on the silk, sits a small inkstone and
brush rest: seven ink dots and four brush tips. Each group is a real radio
group (`<fieldset>`, `<legend>`, labelled inputs, arrow keys move within a
group), not hit-tested shapes. Show the current brush-and-ink as a tiny
sample stroke. The choice can change between strokes but not during one
(see "Several strokes, then Publish"). Keyboard dots use the chosen brush
and ink too. The Publish button sits at the end of the tray. Without JavaScript the tray isn't shown at all,
since there's nothing to draw with.

**Data.** Brush and ink are stored per stroke inside the mark's row (see
"Storage" above). Existing rows count as `broad` / `jiao`, so every
existing mark renders exactly as it does today. The server accepts only
ids from these two lists and rejects anything else with a 400. An absent
field means the default. The wet-ink stream and the SSE "mark published"
event carry brush and ink per stroke, so other viewers see the right wet
colour while it's drawn. The
server-rendered `/` draws each mark with its own brush and ink, with or
without JavaScript.

## Tests (these gate the deploy)

`spec/scroll.test.ts` should keep every promise it holds now (persistence,
validation, no delete, no painting outside your strip), rewritten around
claims where needed. Add specs that would have failed before this work:

- two claims made back to back get **different** strips, and both saves
  succeed (the old 409 scenario now gives two marks, not one);
- a save outside your own claimed strip, or with no or someone else's claim
  token, is refused;
- a second SSE client receives a newly saved mark within about one second;
- wet-ink points from a valid claim reach another SSE client, and points
  outside the claim do not;
- an expired claim's strip is handed to the next claimer;
- an unknown brush or ink id is refused with a 400, a mark saved with a
  given brush and ink comes back with them on a fresh `GET /` (no JS), and
  a mark with no brush or ink is saved as `broad` / `jiao`;
- a `wash` (widest-halo) mark hugging the strip edge is refused, even
  though the same path with `fine` would fit;
- a published mark with several strokes is one row: the page count goes up
  by one, and every stroke appears on a no-JS `GET /`;
- publishing is all or nothing: one bad stroke (outside the strip, unknown
  brush, bad grammar) refuses the whole mark, and nothing is written;
- more than the stroke cap, or an empty publish, is refused;
- a claim holder can lift one of their own wet strokes, and the lift reaches
  another SSE client; lifting with a wrong or missing token, or naming a
  stroke under someone else's claim, is refused;
- nothing can remove a published mark: after publishing, the same lift call
  is refused and the mark is still on `GET /`;
- a lapsed claim's wet strokes are never saved.

`spec/invariants.test.ts` stays green and unchanged. `pnpm check` and
`pnpm check:evidence` pass before every commit, and each commit is a
reviewable step, not one big dump.

## Writing it down

- `docs/adr/0001-concurrent-drawers.md`: context, the decision, the
  alternatives above with why each lost, and what it costs (claims in
  memory, possible brief gaps while a claim is held, timeout tuning, wet
  ink as the only presence). Tie it to `README.md`'s definition of good.
- Update `README.md` so it describes the app as it now is. The "judged, not
  enforced" and "what's here now" sections currently say real-time is next
  crit's job and that a stale strip gets refused. Both are about to be
  false. `/readme/` serves it, so it is user-facing.
- Add a short C9 section to `PROCESS.md`. No reflection needed.

## Leave alone

- Never add an update or delete path for saved marks. The eraser works on
  your own unpublished wet strokes only, never on a published mark or on
  anyone else's. No accounts, no likes, no gallery, no moderation. Still one mark per visit
  (enforcing that per person is out of scope).
- No new services (Redis, a queue, a second database) and no client-side
  framework. Hand-written TS in `src/lib/` like `draw.ts`.
- Existing marks must look exactly as they do today (`broad` + `jiao`).
  Don't add brushes or inks beyond the lists above, and no free colour
  picker. Don't touch the top block of `CLAUDE.md`.

## What done looks like

Two browser windows side by side on the live Fly URL. Paint several strokes
in one, changing ink between them, and the other sees pale wet ink (in each
stroke's brush and ink) following the brush in a strip next to its own.
Press Publish, and the whole mark darkens at once in both windows while the
seal stamps in the first. Both people can paint at once, both marks are
kept, nobody reloads. Check this
against the deployed site after CI deploys, not just locally. If it isn't
true there, you're not done.
