# Process overview

## From the brief to a decision

The final project brief fixes three requirements (multi-user, real-time,
persists) and leaves what "good" means to me. Crit 8 asks only for proof of
life: deployed, doing its core thing for a stranger, with a trace that's
still there when they come back. Rather than plan a feature-complete app and
ship a fraction of it, I picked one small idea and built all of it: **The
Scroll**, a shared ink canvas that only ever grows, one mark per visit, none
of them ever erased.

The brief's reading list (the small web, games for a handful of friends,
tools for one workshop) pointed away from the "median answer" it warns
against, a chat room with the nouns swapped. A drawing surface with a hard
rule against editing is small, testable, and takes a position.
`README.md` argues that position and cites what I read; this file doesn't
restate it.

## The stack, and what it costs

**Astro in server mode, the Node adapter, `better-sqlite3` with no ORM**
([`b3e5356`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-baishi/commit/b3e5356)).
The app is two rendered pages and one write endpoint. Astro's file routing
gives me that without the middleware boilerplate of a bare Express server,
and server output means `/` reads the database on every request, so the
scroll renders with JavaScript off. The adapter's standalone mode is a
single `node entry.mjs` process, which is what a 256MB Fly machine can run.

Drizzle was the obvious alternative. I didn't take it because the schema is
one table: a `CREATE TABLE IF NOT EXISTS` and two prepared statements say
everything a migration tool would, without a generate step or the
dependency weight. The cost is real and deferred, not avoided. When crit 9
needs a second table for identity, or transactions around concurrent
writes, that absence will start to hurt, and I'll write down the switch if
I make it rather than drift into it.

The Dockerfile is two stages: build, then a runtime with production
dependencies only. It originally installed `python3 make g++` with a
comment claiming they were a fallback for `better-sqlite3`. I checked the
package rather than the comment: it has no install script and ships
prebuilt N-API binaries per platform, so the fallback could never run. The
toolchain went
([`961bafc`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-baishi/commit/961bafc)),
which is the README's "less technology" standard applied to the build.

## How I directed the work

I designed the interaction (a variable-width brush from real pointer speed,
a scroll that grows by one blank strip per mark, the enforced/judged split
in `README.md`) and the API's validation rules myself.
`CLAUDE.md` turns that argument into rules the agent works under: never
update or delete a mark, never require an account, validate in the data
layer rather than trusting `draw.ts`, keep to one table on one volume, and
don't build crit 9's real-time layer early. Its opening line says a rule
that doesn't trace back to a sentence in `README.md` doesn't belong in
either file.

## How I grounded and corrected it

A green `pnpm check` was never treated as proof the interaction worked.
Every change was checked against the container CI actually builds
(`docker build`, then `docker run --tmpfs /data` as `checks.yml` does), and
in a real browser with real pointer and keyboard input.

That caught the first bug a code read hadn't. A single tap saved correctly
but rendered as nothing, because an SVG path of just `M x y` has no
paintable geometry. The fix went into the data layer, not just the client
that produced it: `addStroke` normalises a bare moveto, and
`spec/scroll.test.ts` asserts every saved path is paintable
([`0a10659`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-baishi/commit/0a10659)).
That's the pattern I held to afterwards: a correction lands in `CLAUDE.md`
or `spec/`, not just at the call site.

The biggest correction came from re-reading my own rule. For ten passes
"never erased" meant no update or delete statement, and that held. It
didn't cover overpainting. The zone uses `setPointerCapture`, so an
over-long drag kept reporting points outside it, and the API accepted any
path. I reproduced it live (a real drag swept back across three earlier
marks) before touching anything. The fix pins points to the zone in
`draw.ts`, and `strokes.ts` parses the path strictly and refuses any point,
halo included, outside the current strip. Two new spec cases would have
failed beforehand, and `CLAUDE.md` now says overpainting is erasing
([`3a57fdf`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-baishi/commit/3a57fdf)).
That fix created a stale-strip refusal for two visitors loading at once.
The first version reopened the zone and told the visitor to retry, which
`README.md` contradicted. A 409 now names the cause and keeps the zone
closed
([`070af85`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-baishi/commit/070af85)).

Three more fixes came from checking claims against behaviour rather than
markup:

- keyboard drawing: adding `tabindex` to the zone looked fixed but wasn't,
  because its parent `<svg role="img">` hid every descendant from assistive
  tech. The role came off and the zone became a real button that Enter and
  Space drive
  ([`fbb528d`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-baishi/commit/fbb528d))
- contrast: axe reported zero violations while two elements sat under 3:1,
  one dimmed by an ancestor's `opacity` and one in SVG text axe can't
  measure. I found them by computing the ratios by hand
  ([`874ccac`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-baishi/commit/874ccac)),
  then found the same bad colour still on every `/readme/` link
  ([`7e2939a`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-baishi/commit/7e2939a))
- pointer identity: `drawing` was a boolean, so a second touch's release
  threw inside an async handler and silently dropped the real mark
  ([`75bc2b5`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-baishi/commit/75bc2b5)).

That last one has no spec test, deliberately. jsdom has no
`createSVGPoint`, `getScreenCTM` or `setPointerCapture`, so the bug isn't
"the kind a test can hold" in `CLAUDE.md`'s terms. A two-pointer browser
reproduction, before and after, is the verification.

Smaller passes added a favicon after Lighthouse flagged a console error on
every load
([`36f8174`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-baishi/commit/36f8174)),
touch-callout and tap-highlight overrides on the drawing zone
([`17216c8`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-baishi/commit/17216c8)),
and in-range dependency patches. Some checks came back clean and changed
nothing: dark-mode contrast, 200% zoom, and an `html-validate` warning I
confirmed is the tool contradicting its own rules.

## Crit 9: all at once (pod 2's riff)

Pod 2 wrote this crit's brief (`prompt.md`), and I ran it unattended in
one pass. Their diagnosis was right: four people opening the scroll
together got the same strip, three of them lost a finished mark to a 409,
and nobody saw anybody else. Their decision was that every painter gets
their own strip and everyone watches the wet ink. I built that and argued
it in `docs/adr/0001-concurrent-drawers.md`.

The order was server first, so the claim was enforced before any client
relied on it. Claims, wet ink over SSE and whole-mark publish came with a
rewritten `spec/scroll.test.ts` (23 cases, every one the brief listed)
([`96f3a24`](https://github.com/comp4020-agentic-coding-studio/comp4020-riff8-baishi-2/commit/96f3a24)). Then the client
([`8e8476b`](https://github.com/comp4020-agentic-coding-studio/comp4020-riff8-baishi-2/commit/8e8476b)), then the handscroll design
([`5f45095`](https://github.com/comp4020-agentic-coding-studio/comp4020-riff8-baishi-2/commit/5f45095)). Two calls the brief left open: the
spec tests expiry by asking for a shorter claim (a request can only shorten
its own hold), and older rows get their strip derived on read rather than
backfilled, so `db.ts` still has no UPDATE.

Checking in a real browser changed three things the specs couldn't see.
The first dry brush streaked across the stroke, not along it, and a
straight wet stroke vanished, because a box-relative filter region clips a
zero-height bounding box
([`beac458`](https://github.com/comp4020-agentic-coding-studio/comp4020-riff8-baishi-2/commit/beac458)). The page also opened on a strip
someone else already held, because the client learned about claims only
when the stream's first event arrived. And two of the brief's own contrast
figures were wrong: cinnabar on the silk is 2.4:1, not 4.4:1, so focus
rings there went light, and dimming the paper in dark mode would take
light ink under 3:1, so the paper doesn't dim. Both are written down where
they deviate from the brief.

## What's still open

"One mark per visitor" is still judged, not enforced: the only identity is
a claim's anonymous token. Claims and wet ink live in memory, so a restart
costs whatever was mid-paint; the ADR names that cost and the others.
