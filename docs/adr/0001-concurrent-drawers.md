# 1. Two people painting at the same time

- Status: accepted
- Date: 2026-10-07
- Decided for crit 9, "All at once", from pod 2's brief

## Context

Crit 9 asks for one decision about how The Scroll behaves when several
people use it at once. The question that matters here is what happens when
two people paint at the same time, because that's where the crit 8 app
broke.

Every visitor was offered the blank strip at `zoneStart(count)`, so
everyone who loaded together was offered the same one. The first to lift
their brush saved; everyone else had already painted, got a 409 ("someone
else drew in this strip first. Reload"), and lost their mark. That was the
honest stopgap for crit 8, because the alternative was painting over the
first mark, and `CLAUDE.md` says overpainting is erasing. But it meant the
mark that went *right* was thrown away for being slow. The winner's page
then reloaded with a white flash, and nobody saw anybody else until they
reloaded too.

`README.md` defines good as **small on purpose**: one surface, one mark
per visit, one table, one process, nothing that needs a second service.
Whatever replaces the refusal has to fit inside that.

## Decision

**Every painter gets their own strip, and everyone watches the ink go down
while it's still wet.**

- A strip is claimed when the brush first goes down (pointerdown, or Enter
  or Space), not when the mark is saved. The server hands out the lowest
  strip that is neither published into nor held by a live claim, along with
  a random token, which is the only identity there is. Two people who start
  together get neighbouring strips.
- The server enforces the claim. A publish is accepted only with a live
  token, and only if every stroke, halo included, sits inside that token's
  strip at that brush's own reach (`zoneBounds`). Wet ink is checked the
  same way: points outside the claim are dropped, and a token the server
  doesn't hold gets nothing through.
- A mark is several strokes, made final by pressing Publish. Until then
  the strokes are wet: held in the server's memory under the claim and
  shown live to everyone else, lighter and softer. Publishing writes the
  whole mark as one row in one statement, and it dries in every open
  window at once.
- A claim ends when its mark is published, or 90 seconds after its last
  wet point, stroke or lift. The painter is warned 15 seconds before.
  Their wet ink then lifts for everyone, and the strip goes back into the
  pool, so the lowest-free rule closes the gap rather than leaving a
  permanent hole.
- Wet ink is the only presence. There are no cursors, names, avatars or
  "N online" counters. The label under the scroll notices how many strips
  are being painted, which is the paper's state, not a list of people.
- The transport is server-sent events from one Astro endpoint, with the
  subscriber set in memory. The traffic is almost all server-to-client;
  wet points go up as small throttled POSTs.

## Options considered

**Keep the 409 and push live updates.** The cheapest change: the stale
strip would move as soon as someone else saved, so fewer people would hit
the refusal. But the refusal still lands on whoever is mid-stroke when
someone else lifts their brush, and a slow, careful mark is exactly the
kind most likely to lose. Live updates would make the loss visible sooner,
not rarer. Rejected because it keeps punishing the slower painter.

**One shared strip, with concurrent marks layered on top of each other.**
This is the most "together" option, and closest to a room of people around
one sheet. It's also overpainting by design. The one promise the app makes
is that a mark, once made, stays as it was made, and a later mark landing
on it breaks that just as surely as an UPDATE would. Rejected by
`CLAUDE.md`.

**First come, first queued ("you're next, wait").** Fair, and it keeps
one strip in play at a time. But a crit of six people at once would mean
five of them watching one person paint for up to a minute each, and the
crit is exactly that situation. Rejected because waiting your turn is the
opposite of "all at once".

**Publish a lapsed draft automatically instead of lifting it.** This would
save the work of someone who wandered off, but publishing is the
visitor's decision, the moment they say "this one". A mark published by a
timer is a mark nobody chose. Rejected; the 15-second warning is there so
the choice stays theirs.

**A pixel eraser.** Kinder still, but a stroke is the unit that gets
stored and validated. A partial stroke would need masks the server can't
check against the strip. The eraser lifts whole wet strokes.

## What it costs

- **Claims and wet ink live in memory.** A restart or redeploy loses
  every claim and every unpublished stroke. (Fly's auto-stop doesn't:
  an open event stream counts as traffic, so the machine only stops once
  nobody has the page open, and then nobody is painting.) One in-progress mark per painter is what a restart
  costs. The client notices on reconnect (its strip isn't in the room's
  snapshot) and says so plainly before the painter adds another stroke.
  Saving drafts would need a second table, and wet ink is meant to be
  ephemeral anyway.
- **Brief gaps.** While a claim is held, the scroll can show a blank,
  faintly washed strip between published marks. If the claim lapses, the
  next painter fills it, but for up to 90 seconds the scroll has a hole a
  stranger might read as a missing mark.
- **Timeout tuning.** 90 seconds is a guess: long enough to think between
  strokes, short enough that a walked-off phone doesn't hold a strip for
  long. Too short punishes a slow painter (the thing this decision exists
  to stop); too long leaves more gaps. A claim request may ask for a
  *shorter* hold, never a longer one. That's how the spec tests expiry
  without waiting 90 seconds, and it can only shorten the caller's own
  claim.
- **Abuse is bounded, not prevented.** Without identity, a script can hold
  claims. Caps keep that small: 32 live claims, 24 strokes a mark, 800 wet
  points a stroke, a per-claim request budget, 200 open streams. At worst
  the scroll shows 32 empty washed strips for 90 seconds.
- **Wet ink is the only presence.** Someone who has the scroll open but
  isn't painting is invisible. That's deliberate (`README.md`'s case
  against the affordances of software built to scale), but it means a
  quiet room looks empty.
- **The eraser changes what the scroll records.** Drafting is kinder, but
  hesitations a painter lifts are gone. The line the app draws moves from
  "every stroke is final" to "the mark is final once it's dry", and the
  Publish button says so: "Publish: no more erasing after this".

## Notes on the data

Still one table: a published mark is one row, with its strokes (path,
width, brush, ink) in a JSON column and its strip in a `strip` column.
Rows from before this change keep their `d` and `width`, render as
one-stroke `broad`/`jiao` marks exactly as before, and get their strip
derived on read (their position, which is where crit 8 always put them)
rather than backfilled by an UPDATE. So `db.ts` still has no update or
delete statement.
