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
  for being slow. A claim ends when its mark is saved, or after a short
  timeout (somewhere around 30 to 60s, your call) if the drawer walks off.
  An expired strip goes back into the pool, so the scroll gets no
  permanent holes.
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
  else sees their stroke appear live in that person's strip, lighter and
  grey-blue, with no halo: ink that hasn't dried. When it's saved it
  *dries*. It darkens into the normal ink with its soft halo, through a
  short transition (a few hundred ms; respect
  `prefers-reduced-motion`). A strip that's been claimed but not yet drawn
  in can show a faint "someone's here" wash. Those are the only signals of
  presence: no cursors, no avatars, no names, no "3 people online"
  counter. The README's case for small-on-purpose is why. Wet ink is
  never saved and never shown to a visitor who arrives after it's gone.
- **Your own mark dries in place.** Drop `location.reload()`. After saving,
  your stroke darkens where it is, the status line says something like
  "yours is mark 68. It stays.", and your page closes for drawing (still
  one mark per visit). The scroll keeps updating live around it.

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
- an expired claim's strip is handed to the next claimer.

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

- Never add an update or delete path for saved marks. No undo, no
  accounts, no likes, no gallery, no moderation. Still one mark per visit
  (enforcing that per person is out of scope).
- No new services (Redis, a queue, a second database) and no client-side
  framework. Hand-written TS in `src/lib/` like `draw.ts`.
- Don't change the look of saved marks (ink, halo, paper) beyond the drying
  transition. Don't touch the top block of `CLAUDE.md`.

## What done looks like

Two browser windows side by side on the live Fly URL: draw in one, and the
other sees grey wet ink following the brush in a strip next to its own,
which darkens into a real mark the moment the first drawer lifts. Both
people can draw at once, both marks are kept, nobody reloads. Check this
against the deployed site after CI deploys, not just locally. If it isn't
true there, you're not done.
