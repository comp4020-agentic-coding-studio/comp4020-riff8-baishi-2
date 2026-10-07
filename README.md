# The Scroll

A shared ink painting that only ever grows. Visit, and there's a bright
blank strip waiting at the right-hand end of whatever everyone before you
has painted. Paint your mark there: a stroke, a few strokes, a bamboo stalk,
a character. While you paint, anyone else with the scroll open watches your
ink go down, still wet. When you press Publish it dries, in place, in every
open window at once, and it's part of the scroll from then on. **The mark
is final once it's dry**: until then you can lift a wet stroke off the
paper, and after it nobody can undo it, including you.

## What good means here

Good, for this app, means **small on purpose**. Not small because it isn't
finished yet, but small as the actual design: one shared surface, one mark
per visit, nothing that scales past what a single SQLite file and a single
small machine can hold. Three things I read while deciding what that should
look like:

- Robin Sloan's
  [_An app can be a home-cooked meal_](https://www.robinsloan.com/notes/home-cooked-app/)
  argues that software built for a small, specific, known use doesn't need
  the affordances — accounts, growth, retention — that software built to
  scale needs. The Scroll has no login and no notion of "your" marks once
  they're made, because nothing here is trying to bring you back for a
  streak.
- Ben Hoyt's [_The small web is beautiful_](https://benhoyt.com/writings/the-small-web-is-beautiful/)
  argues for fewer moving parts as a virtue in itself, not just a
  constraint: one table, one process, one file on one volume. There's no
  queue, no cache, no second service. The live layer is the same process
  holding a list of open connections.
- Hundred Rabbits'
  [description of their own practice](https://sourcehut.org/blog/2021-12-08-100-rabbits-interview/) —
  "if we can use less technology to solve any one task, we will" — is the
  standard I held the drawing itself to: SVG paths, one write per mark, no
  client-side framework.

## Several people at once

When several people open the scroll together, **every painter gets their
own strip, and everyone watches the ink go down while it's still wet.** The
moment your brush first touches the paper, the server hands you the lowest
strip nobody has published into and nobody else is holding. Two people who
start together get neighbouring strips, so nobody's mark is refused for
being slower than someone else's. The full argument, with the options I
didn't take and what this one costs, is in
[`docs/adr/0001-concurrent-drawers.md`](docs/adr/0001-concurrent-drawers.md).

Wet ink is the only sign anyone else is here: lighter, softer strokes
appearing in someone's strip, and the label under the scroll noticing how
many people are painting. No cursors, names, avatars or counters. If a
painter walks away, their strip waits 90 seconds after their last stroke,
warns them 15 seconds before, then lifts the wet ink and goes back into the
pool. Nothing unpublished is ever saved.

## Brushes and inks

Before each stroke you choose a brush and an ink, from Chinese ink
painting's own short lists rather than a colour picker: four tones of black
ink ("ink has five colours") and three mineral pigments, and four brushes —
soft goat-hair, a wolf-hair liner, flying white (the dry brush whose
bristles part and let the paper through) and a wet wash. A scroll where
every mark used an arbitrary colour would stop reading as one piece; a short
fixed set keeps it whole and still gives each mark a voice. Cinnabar red
isn't an ink: it's kept for the seal that stamps your own mark, on your page
only, so red on the scroll always means "yours".

## What's enforced, and what's judged

What's **enforced**: a published mark is never edited or deleted (there is
no code path that can — see `CLAUDE.md`), and nor can a later one paint
over it, since every stroke has to stay inside its painter's own claimed
strip, soft edge and all, measured by that brush's own reach. The eraser
only reaches strokes held under your own claim and not yet published. Every
write, wet or dry, is validated server-side regardless of what the client
sends (`spec/scroll.test.ts`). The page that shows the scroll works without
JavaScript: every mark, in its own brush and ink, is drawn by the server,
and only painting and the live updates need a script. Painting doesn't need
a pointer: the strip is a real focusable control, the arrow keys move a
brush tip around it, and Enter or Space leaves a dot.

What's **judged, not enforced**: nothing stops a visitor from reloading and
painting a second mark, or a tenth. Enforcing "one mark per person" needs a
real notion of a person, and the only identity here is the anonymous token
a claim hands back. For now the scroll trusts you the way a paper one would:
nothing stops you picking up the brush twice, and not doing so is part of
what the piece asks of you.

What I deliberately **didn't build**: accounts, a gallery of past scrolls,
likes, moderation tooling. The eraser is a deliberate, narrow exception to
"no undo": blotting wet ink off before it sets is something a painter can
do, so drafting is kinder, but it means the scroll no longer records every
hesitation, only what each painter chose to publish. Once dry, ink-wash
painting tolerates the mark that went wrong, and so does this.

## What's here now

One growing SVG scroll, one `strokes` table with a row per published mark,
and a live layer of server-sent events from the same process: claims, wet
ink, lifts and dried marks reach every open window within a second, and a
window that loses its connection catches up on what it missed without
reloading.
