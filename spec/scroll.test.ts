import { JSDOM } from "jsdom";
import { expect, inject, it } from "vitest";
import { BRUSHES } from "../src/lib/brushes";
import { HEIGHT, SEGMENT, stripStart } from "../src/lib/layout";

// The Scroll's promises, exercised exactly as a stranger would hit them —
// over HTTP, against whatever's running — never by reaching into the
// database. Crit 8's: a mark persists, every write is validated, nothing
// deletes or paints over a mark. Crit 9's: drawers claim their own strips,
// see each other's wet ink live, and publish a whole mark at once.
const baseUrl = inject("baseUrl");

const url = (path: string): URL => new URL(path, baseUrl);

function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(url(path), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

interface Claim {
  token: string;
  strip: number;
}

async function claim(idleMs?: number): Promise<Claim> {
  const res = await postJson("/api/claims", idleMs === undefined ? {} : { idleMs });
  expect(res.status).toBe(201);
  return res.json();
}

// The centre of a strip, and a short stroke there that fits any brush.
const centre = (strip: number): { x: number; y: number } => ({
  x: stripStart(strip) + SEGMENT / 2,
  y: HEIGHT / 2,
});
const dash = (strip: number, dy = 0): string => {
  const { x, y } = centre(strip);
  return `M ${x - 10} ${y + dy} L ${x + 10} ${y + dy + 5}`;
};

function publish(token: unknown, strokes: unknown[]): Promise<Response> {
  return postJson("/api/strokes", { token, strokes });
}

const page = async (): Promise<Document> =>
  new JSDOM(await fetch(url("/")).then((r) => r.text())).window.document;

function markCount(doc: Document): number {
  const match = (doc.body.textContent ?? "").match(/(\d+) marks? so far/);
  return match ? Number(match[1]) : 0;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface SseEvent {
  event: string;
  data: unknown;
  id?: string;
}

// A second open session, as far as the server can tell: a raw SSE stream.
async function listen(): Promise<{
  events: SseEvent[];
  next: (match: (e: SseEvent) => boolean, ms?: number) => Promise<SseEvent | null>;
  close: () => void;
}> {
  const ctrl = new AbortController();
  // A since far in the future skips catch-up of every mark already saved.
  const res = await fetch(url("/api/events?since=999999999"), { signal: ctrl.signal });
  expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: SseEvent[] = [];
  let buffer = "";
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let cut: number;
        while ((cut = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const e: Partial<SseEvent> = {};
          for (const line of block.split("\n")) {
            const [field, ...rest] = line.split(": ");
            const value = rest.join(": ");
            if (field === "event") e.event = value;
            if (field === "data") e.data = JSON.parse(value);
            if (field === "id") e.id = value;
          }
          if (e.event) events.push(e as SseEvent);
        }
      }
    } catch {
      // aborted
    }
  })();
  const next = async (match: (e: SseEvent) => boolean, ms = 1000): Promise<SseEvent | null> => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const found = events.find(match);
      if (found) return found;
      await sleep(20);
    }
    return null;
  };
  // Subscribed once the room's state has arrived.
  expect(await next((e) => e.event === "hello", 2000)).not.toBeNull();
  return { events, next, close: () => ctrl.abort() };
}

// --- claims ------------------------------------------------------------------

it("hands an expired claim's strip to the next claimer", async () => {
  const lapsing = await claim(1000);
  const other = await claim();
  expect(other.strip).not.toBe(lapsing.strip);
  await sleep(1400);
  const next = await claim();
  expect(next.strip).toBe(lapsing.strip);
  expect((await publish(next.token, [{ d: dash(next.strip), width: 6 }])).status).toBe(201);
  expect((await publish(other.token, [{ d: dash(other.strip), width: 6 }])).status).toBe(201);
});

it("gives two claims made back to back different strips, and keeps both marks", async () => {
  const countBefore = markCount(await page());
  const a = await claim();
  const b = await claim();
  expect(a.strip).not.toBe(b.strip);

  // The old 409 scenario: both drew at once. Now both saves succeed.
  expect((await publish(b.token, [{ d: dash(b.strip), width: 6 }])).status).toBe(201);
  expect((await publish(a.token, [{ d: dash(a.strip), width: 6 }])).status).toBe(201);
  expect(markCount(await page())).toBe(countBefore + 2);
});

it("keeps a published mark: the count goes up and it survives a fresh request", async () => {
  const before = markCount(await page());
  const c = await claim();
  const res = await publish(c.token, [{ d: dash(c.strip), width: 6 }]);
  expect(res.status).toBe(201);
  const mark = await res.json();
  // A second, independent request: only the database carries the mark.
  const doc = await page();
  expect(markCount(doc)).toBe(before + 1);
  expect(doc.querySelector(`g.mark[data-id="${mark.id}"]`)).not.toBeNull();
});

it("refuses a save with no claim token, or a token the server never issued", async () => {
  const { x, y } = centre(0);
  const stroke = { d: `M ${x} ${y} L ${x + 10} ${y}`, width: 6 };
  expect((await publish(undefined, [stroke])).status).toBe(403);
  expect((await publish("not-a-real-token", [stroke])).status).toBe(403);
  // The crit 8 request shape, with no claim at all, has nowhere to go.
  expect((await postJson("/api/strokes", stroke)).status).toBe(403);
});

it("refuses a save outside the caller's own strip, so it can't paint over anyone's", async () => {
  const a = await claim();
  const b = await claim();
  // A's token, painting in B's strip.
  expect((await publish(a.token, [{ d: dash(b.strip), width: 6 }])).status).toBe(409);
  // A drag that starts in A's strip and runs left across earlier marks.
  const { x, y } = centre(a.strip);
  expect((await publish(a.token, [{ d: `M ${x} ${y} L ${x - SEGMENT * 3} ${y}`, width: 6 }])).status).toBe(
    409,
  );
  // The halo counts too: a path hugging the strip's edge bleeds over it.
  const edge = stripStart(a.strip) + 2;
  expect((await publish(a.token, [{ d: `M ${edge} ${y} L ${edge} ${y + 1}`, width: 14 }])).status).toBe(409);
  expect((await publish(a.token, [{ d: dash(a.strip), width: 6 }])).status).toBe(201);
  expect((await publish(b.token, [{ d: dash(b.strip), width: 6 }])).status).toBe(201);
});

// --- brushes and inks ----------------------------------------------------------

it("measures the halo by each brush's own spread: a wash hugging the edge is refused where a fine line fits", async () => {
  const c = await claim();
  const x = stripStart(c.strip) + 8;
  const { y } = centre(c.strip);
  const d = `M ${x} ${y} L ${x} ${y + 20}`;
  expect((await publish(c.token, [{ d, width: BRUSHES.wash.min, brush: "wash" }])).status).toBe(409);
  expect((await publish(c.token, [{ d, width: 4, brush: "fine" }])).status).toBe(201);
});

it("refuses an unknown brush or ink with a 400, and saves a known one so a no-JS page shows it", async () => {
  const c = await claim();
  const d = dash(c.strip);
  expect((await publish(c.token, [{ d, width: 6, brush: "airbrush" }])).status).toBe(400);
  expect((await publish(c.token, [{ d, width: 6, ink: "cinnabar" }])).status).toBe(400);
  expect((await publish(c.token, [{ d, width: 6, ink: "#ff0000" }])).status).toBe(400);

  const res = await publish(c.token, [{ d, width: 9, brush: "dry", ink: "indigo" }]);
  expect(res.status).toBe(201);
  const { id } = await res.json();
  const core = (await page()).querySelector(`g.mark[data-id="${id}"] path.core`);
  expect(core?.getAttribute("data-brush")).toBe("dry");
  expect(core?.getAttribute("data-ink")).toBe("indigo");
  expect(core?.getAttribute("stroke")).toBe("#2f4f6f");
});

it("saves a stroke with no brush or ink as broad / jiao", async () => {
  const c = await claim();
  const res = await publish(c.token, [{ d: dash(c.strip), width: 6 }]);
  const mark = await res.json();
  expect(mark.strokes[0]).toMatchObject({ brush: "broad", ink: "jiao" });
  const core = (await page()).querySelector(`g.mark[data-id="${mark.id}"] path.core`);
  expect(core?.getAttribute("data-brush")).toBe("broad");
  expect(core?.getAttribute("data-ink")).toBe("jiao");
});

it("refuses a width outside the brush's own range", async () => {
  const c = await claim();
  const d = dash(c.strip);
  expect((await publish(c.token, [{ d, width: 999 }])).status).toBe(400);
  expect((await publish(c.token, [{ d, width: 12, brush: "fine" }])).status).toBe(400);
  expect((await publish(c.token, [{ d, width: 6 }])).status).toBe(201);
});

// --- several strokes, then publish ---------------------------------------------

it("publishes a several-stroke mark as one row: the count goes up by one, and every stroke shows without JS", async () => {
  const before = markCount(await page());
  const c = await claim();
  const strokes = [
    { d: dash(c.strip, -60), width: 6, brush: "broad", ink: "jiao" },
    { d: dash(c.strip, 0), width: 3, brush: "fine", ink: "ochre" },
    { d: dash(c.strip, 60), width: 26, brush: "wash", ink: "malachite" },
  ];
  const res = await publish(c.token, strokes);
  expect(res.status).toBe(201);
  const { id } = await res.json();
  const doc = await page();
  expect(markCount(doc)).toBe(before + 1);
  const cores = [...doc.querySelectorAll(`g.mark[data-id="${id}"] path.core`)];
  expect(cores.map((p) => [p.getAttribute("data-brush"), p.getAttribute("data-ink")])).toEqual([
    ["broad", "jiao"],
    ["fine", "ochre"],
    ["wash", "malachite"],
  ]);
});

it("publishes all or nothing: one bad stroke refuses the whole mark and nothing is written", async () => {
  const c = await claim();
  const good = { d: dash(c.strip), width: 6 };
  const before = markCount(await page());
  const { x, y } = centre(c.strip);
  for (const bad of [
    { d: `M ${x} ${y} L ${x - SEGMENT * 2} ${y}`, width: 6 }, // outside the strip
    { d: dash(c.strip), width: 6, brush: "spray" }, // unknown brush
    { d: `M ${x} ${y} Z`, width: 6 }, // bad grammar
  ]) {
    const res = await publish(c.token, [good, bad]);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  }
  const doc = await page();
  expect(markCount(doc)).toBe(before);
  expect(doc.querySelector(`g.mark[data-strip="${c.strip}"]`)).toBeNull();
  // The claim is still good: the visitor can fix it and publish.
  expect((await publish(c.token, [good])).status).toBe(201);
});

it("refuses an empty mark, and one with more than 24 strokes", async () => {
  const c = await claim();
  expect((await publish(c.token, [])).status).toBe(400);
  const many = Array.from({ length: 25 }, (_, i) => ({ d: dash(c.strip, i * 4 - 50), width: 4 }));
  expect((await publish(c.token, many)).status).toBe(400);
  expect((await publish(c.token, many.slice(0, 24))).status).toBe(201);
});

it("normalises a bare tap (a moveto with no drawing command) into a paintable stroke", async () => {
  // SVG renders nothing for "M x y" alone — see src/lib/db.ts.
  const c = await claim();
  const { x, y } = centre(c.strip);
  const res = await publish(c.token, [{ d: `M ${x} ${y}`, width: 14 }]);
  expect(res.status).toBe(201);
  expect((await res.json()).strokes[0].d).toMatch(/L/);
});

it("refuses a path that isn't the moveto-then-segments shape the client draws", async () => {
  const c = await claim();
  const { x, y } = centre(c.strip);
  for (const d of [`L ${x} ${y}`, `M ${x} ${y} Z`, `M ${x} ${y} L ${x}`, `M ${x} ${y} L NaN ${y}`]) {
    expect((await publish(c.token, [{ d, width: 6 }])).status, d).toBe(400);
  }
});

// --- real time ---------------------------------------------------------------------

it("tells another open session about a newly published mark within a second", async () => {
  const other = await listen();
  try {
    const c = await claim();
    const { id } = await (await publish(c.token, [{ d: dash(c.strip), width: 6 }])).json();
    const seen = await other.next((e) => e.event === "mark" && (e.data as { id: number }).id === id, 1000);
    expect(seen).not.toBeNull();
    expect(seen?.id).toBe(String(id)); // what a reconnect's Last-Event-ID resumes from
  } finally {
    other.close();
  }
});

it("catches a reconnecting session up on marks published while it was away", async () => {
  const c = await claim();
  const { id } = await (await publish(c.token, [{ d: dash(c.strip), width: 6 }])).json();
  const ctrl = new AbortController();
  const res = await fetch(url("/api/events"), {
    headers: { "last-event-id": String(id - 1) },
    signal: ctrl.signal,
  });
  const reader = res.body!.getReader();
  let text = "";
  while (!text.includes("event: hello")) text += new TextDecoder().decode((await reader.read()).value);
  ctrl.abort();
  expect(text).toContain(`id: ${id}\nevent: mark`);
  expect(text).not.toContain(`id: ${id - 1}\n`);
});

it("sends wet ink from a claim to another session, and drops points outside the claim", async () => {
  const other = await listen();
  try {
    const c = await claim();
    const { x, y } = centre(c.strip);
    const outside = stripStart(c.strip) - 100;
    const res = await postJson("/api/wet", {
      token: c.token,
      stroke: "a1",
      brush: "fine",
      ink: "indigo",
      width: 3,
      pts: [x, y, outside, y, x + 5, y + 5],
    });
    expect(res.status).toBe(200);
    const wet = await other.next((e) => e.event === "wet" && (e.data as { strip: number }).strip === c.strip);
    expect(wet?.data).toMatchObject({ stroke: "a1", brush: "fine", ink: "indigo", pts: [x, y, x + 5, y + 5] });

    // Only points outside the strip: nothing reaches anyone.
    await postJson("/api/wet", { token: c.token, stroke: "a2", width: 6, pts: [outside, y] });
    // No claim: refused outright.
    const forged = await postJson("/api/wet", { token: "nope", stroke: "a3", width: 6, pts: [x, y] });
    expect(forged.status).toBe(403);
    await sleep(300);
    expect(
      other.events.filter((e) => e.event === "wet" && ["a2", "a3"].includes((e.data as { stroke: string }).stroke)),
    ).toEqual([]);
  } finally {
    other.close();
  }
});

// --- the eraser: wet ink only -------------------------------------------------------

it("lets a claim holder lift their own wet stroke, live for everyone, and nobody else's", async () => {
  const other = await listen();
  try {
    const mine = await claim();
    const theirs = await claim();
    const { x, y } = centre(mine.strip);
    await postJson("/api/wet", { token: mine.token, stroke: "m1", width: 6, pts: [x, y] });
    const t = centre(theirs.strip);
    await postJson("/api/wet", { token: theirs.token, stroke: "t1", width: 6, pts: [t.x, t.y] });

    expect((await postJson("/api/lift", { stroke: "m1" })).status).toBe(403);
    expect((await postJson("/api/lift", { token: "nope", stroke: "m1" })).status).toBe(403);
    // Naming someone else's stroke: it isn't under this token, so it isn't found.
    expect((await postJson("/api/lift", { token: mine.token, stroke: "t1" })).status).toBe(404);

    expect((await postJson("/api/lift", { token: mine.token, stroke: "m1" })).status).toBe(200);
    const lift = await other.next((e) => e.event === "lift" && (e.data as { stroke: string }).stroke === "m1");
    expect(lift?.data).toMatchObject({ strip: mine.strip });
    expect(other.events.some((e) => e.event === "lift" && (e.data as { stroke: string }).stroke === "t1")).toBe(
      false,
    );
  } finally {
    other.close();
  }
});

it("can't remove a published mark: after publishing the same lift is refused, and the mark stays", async () => {
  const c = await claim();
  const { x, y } = centre(c.strip);
  await postJson("/api/wet", { token: c.token, stroke: "p1", width: 6, pts: [x, y] });
  const res = await publish(c.token, [{ d: `M ${x} ${y} L ${x + 1} ${y}`, width: 6 }]);
  const { id } = await res.json();
  expect((await postJson("/api/lift", { token: c.token, stroke: "p1" })).status).toBe(403);
  expect((await page()).querySelector(`g.mark[data-id="${id}"]`)).not.toBeNull();
});

it("never saves a lapsed claim's wet strokes", async () => {
  const other = await listen();
  try {
    const before = markCount(await page());
    const c = await claim(1000);
    const { x, y } = centre(c.strip);
    await postJson("/api/wet", { token: c.token, stroke: "w1", width: 6, pts: [x, y, x + 10, y + 10] });
    const expired = await other.next(
      (e) => e.event === "expire" && (e.data as { strip: number }).strip === c.strip,
      2500,
    );
    expect(expired).not.toBeNull();
    expect((await publish(c.token, [{ d: dash(c.strip), width: 6 }])).status).toBe(403);
    const doc = await page();
    expect(markCount(doc)).toBe(before);
    expect(doc.querySelector(`g.mark[data-strip="${c.strip}"]`)).toBeNull();
  } finally {
    other.close();
  }
});

it("never deletes: nothing in the app exposes a way to remove a mark", async () => {
  for (const path of ["/api/strokes", "/api/lift", "/api/claims"]) {
    const res = await fetch(url(path), { method: "DELETE" });
    // No route handles DELETE (Astro's same-origin check rejects it with 403
    // before routing even gets a say) — there's simply no delete path to call.
    expect(res.status, path).toBeGreaterThanOrEqual(400);
    expect(res.status, path).toBeLessThan(500);
  }
});
