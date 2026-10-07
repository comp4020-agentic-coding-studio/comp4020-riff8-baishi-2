# This repo is a pod riff: pods write the prompt, the agent does the work

This repo is a copy of [`comp4020-final-baishi`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-baishi) at
`236607f4` --- baishi's crit agent's final project as it stood at
`08-its-alive`. Their repo is untouched and off limits. From here to the end of
semester, each crit a pod picks this repo up from wherever the last run left
it.

**Pods: the only file you change is `prompt.md`, at the repo root.** Read the
live app, the code and the history, then write the prompt that would take
this app to a strong, interesting answer to the next brief (the crit runsheet
links it). The prompt can point at any file here. After the session,
baishi's crit agent runs `prompt.md` once, unattended, start to finish, and
nobody is there to answer its questions --- so say what you want, what good
looks like and what to leave alone. Push it before you leave.

**Crit agent: when `prompt.md` exists, it is your brief.** Run it to
completion in one go, keep `main` deployable, and delete `prompt.md` in your
last commit. Leave this block of `CLAUDE.md` as it is.

**Nothing here is marked.** No cutoff, no reflection, no `PROCESS.md` entry.
The next crit opens by looking at where each pod repo ended up, beside the
prompt that got it there (the `prompt-crit<N>` tag).

**The agent's own spec tests are `spec/scroll.test.ts`.** They encode the brief it was
working to, and they gate the deploy. A prompt aimed at a different brief can
have them changed or deleted; keep `spec/invariants.test.ts` green, since that
one is true of any good site.

Everything below this line was written for the agent's graded submission. Its
marks, cutoff and weekly skills don't govern this repo: read it for how the
agent was directed, not for what anyone owes.

---

# Your harness

The rules below are derived from `README.md`'s argument, not separate from
it: if a rule here doesn't trace back to a sentence there, it doesn't belong
in either.

## What the app must never do

- **Never delete or edit a published mark.** `src/lib/db.ts` has no update
  or delete statement, and none should be added — not even for moderation.
  If a mark ever needs removing, that's a decision to argue for in
  `README.md` first, with a real mechanism (who can, and why), not a quiet
  admin route. Overpainting is erasing too: every stroke, halo included,
  stays inside its painter's claimed strip at its brush's own reach
  (`zoneBounds` in `src/lib/layout.ts`).
- **The eraser lifts wet ink only.** `/api/lift` finds strokes under the
  caller's own claim token and nowhere else, so it can't reach a published
  mark or anyone else's wet stroke. Keep it that way.
- **Never save wet ink.** Unpublished strokes live in `src/lib/claims.ts`'s
  memory and nowhere else; a lapsed claim's strokes are dropped, never
  published for the painter.
- **Never require an account to draw or to view.** The only identity is
  the random token a claim hands back. Never a login, a name, or a cookie
  that outlives the visit.
- **Wet ink is the only presence.** No cursors, avatars, names or online
  counters (`docs/adr/0001-concurrent-drawers.md`).
- **Never trust the client for anything `spec/` can check.** Path length,
  stroke width, request shape: validate in the data layer
  (`src/pages/api/strokes.ts`), the same place the promise is tested, not
  just in `draw.ts`. Brushes and inks come only from the lists in
  `src/lib/brushes.ts`; no colour picker, and cinnabar stays the seal's.

## What every page holds to

- The page that shows the scroll (`/`) must render every published mark,
  in its own brush and ink, and answer 200 with JavaScript disabled. Only
  painting and the live updates need a script — and within that, a
  pointer is never the only way in: the strip is a real focusable control,
  the arrow keys move a brush tip and Enter/Space paints or lifts wherever
  a pointer does.
- Never move the scroll under someone mid-stroke, and only follow new
  marks to the end if the viewer was already there.
- `/readme/` always serves the current `README.md` in full, headings
  intact — `spec/invariants.test.ts` checks this; don't special-case it
  away.

## What a change must not break

- One SQLite table, one file, one volume, one row per published mark. If a
  change needs a second service (a queue, a cache, a second database),
  that's a bigger decision than this file should wave through — raise it
  in `PROCESS.md` first, with the trade-off named. The live layer
  (`src/lib/live.ts`) is the same process's memory, not a service.
- `pnpm check` and `pnpm check:evidence` pass before every commit. A red
  run never gets committed over.
- Every commit that changes behaviour has a test in `spec/` that would have
  failed without it, where the behaviour is the kind a test can hold —
  see `spec/scroll.test.ts` for the shape (persistence, validation,
  no-delete) established this crit.

## Left open on purpose

"One mark per visitor" is judged, not enforced (`README.md`): enforcing it
needs a notion of a person the app deliberately doesn't have. Don't add
one without arguing for it there first.
