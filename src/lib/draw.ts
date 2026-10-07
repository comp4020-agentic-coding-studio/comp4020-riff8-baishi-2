// The live scroll in the browser: painting your own mark (pointer or
// keyboard), lifting wet strokes, publishing, and watching everyone else's
// wet ink arrive over server-sent events. Hand-written, no framework.
import {
  BRUSHES,
  DEFAULT_BRUSH,
  DEFAULT_INK,
  INKS,
  isBrush,
  isInk,
  maxReach,
  type BrushId,
  type InkId,
} from "./brushes";
import { dryStrokeNodes, markNode, smoothPath, wetStrokeNode, type StrokeData, type SvgNode } from "./ink";
import { drawingNow, marksLabel } from "./label";
import { HEIGHT, SEGMENT, lowestFree, paperWidth, stripStart, totalWidth } from "./layout";

const SVGNS = "http://www.w3.org/2000/svg";
const MIN_MOVE = 2; // px between recorded points, so a slow drag isn't thousands of points
const MAX_POINTS = 600; // per stroke; keeps a path well under the server's length cap
const MAX_STROKES = 24;
const FLUSH_MS = 80; // wet ink goes up in small batches
const WARN_BEFORE_MS = 15_000;
const KEY_STEP = 8;
const FRAME_H = HEIGHT + 36;

interface LocalPoint {
  x: number; // relative to the strip's left edge
  y: number;
  t: number;
}

interface MyStroke {
  id: string;
  brush: BrushId;
  ink: InkId;
  pts: LocalPoint[];
  sent: number; // how many of pts the server has
  el: SVGElement;
}

interface WetView {
  brush: BrushId;
  ink: InkId;
  width: number;
  pts: number[];
  el: SVGElement;
}

interface ClaimView {
  group: SVGGElement;
  strokes: Map<string, WetView>;
}

interface MarkMsg {
  id: number;
  strip: number;
  number: number;
  createdAt: number;
  strokes: StrokeData[];
}

interface WetMsg {
  strip: number;
  stroke: string;
  brush: BrushId;
  ink: InkId;
  width: number;
  pts: number[];
}

function build(node: SvgNode): SVGElement {
  const el = document.createElementNS(SVGNS, node.tag);
  for (const [k, v] of Object.entries(node.attrs)) el.setAttribute(k, String(v));
  for (const child of node.children ?? []) el.appendChild(build(child));
  return el;
}

// A brush dragged quickly lays down a thinner line than one held still —
// the one bit of real ink physics this borrows. A tap is full width.
function widthFor(brush: BrushId, pts: LocalPoint[]): number {
  const { min, max } = BRUSHES[brush];
  if (pts.length < 2) return max;
  let dist = 0;
  let time = 0;
  for (let i = 1; i < pts.length; i++) {
    dist += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    time += Math.max(1, pts[i].t - pts[i - 1].t);
  }
  const w = max / (1 + (dist / time) * 6);
  return Math.round(Math.max(min, Math.min(max, w)) * 10) / 10;
}

// Pinned inside the strip, inset by the widest ink this brush can lay down,
// so a drag that runs off the strip (pointer capture keeps reporting) never
// produces a mark the server would refuse.
function clampLocal(brush: BrushId, x: number, y: number): { x: number; y: number } {
  const r = maxReach(brush);
  return { x: Math.min(Math.max(x, r), SEGMENT - r), y: Math.min(Math.max(y, r), HEIGHT - r) };
}

function distToStroke(pts: { x: number; y: number }[], x: number, y: number): number {
  if (pts.length === 1) return Math.hypot(pts[0].x - x, pts[0].y - y);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
    best = Math.min(best, Math.hypot(a.x + t * dx - x, a.y + t * dy - y));
  }
  return best;
}

const toPairs = (flat: number[]): { x: number; y: number }[] => {
  const out = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ x: flat[i], y: flat[i + 1] });
  return out;
};

const reducedMotion = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function initScroll(root: Document): void {
  const $ = <T extends Element>(sel: string): T => {
    const el = root.querySelector<T>(sel);
    if (!el) throw new Error(`missing ${sel}`);
    return el;
  };
  const wrap = $<HTMLDivElement>("#canvas-wrap");
  const inner = $<HTMLDivElement>(".scroll-inner");
  const svg = $<SVGSVGElement>("#scroll");
  const paper = $<SVGRectElement>("#paper");
  const grain = $<SVGRectElement>("#paper-grain");
  const roller = $<SVGGElement>("#roller");
  const invite = $<SVGGElement>("#invite");
  const prompt = $<SVGTextElement>("#zone-prompt");
  const marksLayer = $<SVGGElement>("#marks");
  const claimsLayer = $<SVGGElement>("#claims");
  const mine = $<SVGGElement>("#mine");
  const seals = $<SVGGElement>("#seals");
  const cursor = $<SVGCircleElement>("#cursor");
  const zone = $<SVGRectElement>("#zone-hit");
  const tray = $<HTMLFormElement>("#tray");
  const inkName = $<HTMLElement>("#ink-name");
  const brushName = $<HTMLElement>("#brush-name");
  const sampleInk = $<SVGGElement>("#sample-ink");
  const eraserBtn = $<HTMLButtonElement>("#eraser");
  const liftBtn = $<HTMLButtonElement>("#lift-last");
  const publishBtn = $<HTMLButtonElement>("#publish");
  const status = $<HTMLElement>("#draw-status");
  const labelCount = $<HTMLElement>("#label-count");
  const labelDrawing = $<HTMLElement>("#label-drawing");
  const newMarksBtn = $<HTMLButtonElement>("#new-marks");

  // What's on the paper.
  const saved = new Set<number>();
  for (const g of marksLayer.querySelectorAll<SVGGElement>(".mark")) saved.add(Number(g.dataset.strip));
  const claims = new Map<number, ClaimView>(); // everyone else's held strips
  let lastId = Number(svg.dataset.lastId) || 0;
  let count = Number(svg.dataset.count) || 0;
  let firstAt: number | null = Number(svg.dataset.firstAt) || null;
  let strips = Number(svg.dataset.strips) || 1;
  let unseen = 0;

  // Your own visit.
  let me: { token: string; strip: number; idleMs: number } | null = null;
  let claiming: Promise<boolean> | null = null;
  let myStrokes: MyStroke[] = [];
  let published = false;
  let publishing = false;
  let drawingPointer: number | null = null;
  let current: MyStroke | null = null;
  let erasing = false;
  let tool: "brush" | "eraser" = "brush";
  let brush: BrushId = DEFAULT_BRUSH;
  let ink: InkId = DEFAULT_INK;
  let keyCursor = { x: SEGMENT / 2, y: HEIGHT / 2 };
  let warnTimer: ReturnType<typeof setTimeout> | null = null;
  let lapseTimer: ReturnType<typeof setTimeout> | null = null;
  let deadline = 0;
  let strokeSeq = 0;

  const inviteStrip = (): number =>
    me?.strip ?? lowestFree([...saved, ...claims.keys()]);

  // --- the label and the status line ---------------------------------------

  const updateLabel = (): void => {
    labelCount.textContent = marksLabel(count, firstAt);
    labelDrawing.textContent = drawingNow(claims.size + (me ? 1 : 0));
  };

  const say = (message: string): void => {
    status.textContent = message;
  };

  const strokeCountMessage = (): string => {
    const n = myStrokes.length;
    if (n === 0) return "No strokes down. Paint in the bright strip, or publish nothing and leave it blank.";
    return `${n} stroke${n === 1 ? "" : "s"} down, not yet published. You can still lift any of them.`;
  };

  const updateButtons = (): void => {
    const open = !published && !publishing;
    const focused = root.activeElement;
    publishBtn.disabled = !open || myStrokes.length === 0;
    liftBtn.disabled = !open || myStrokes.length === 0;
    eraserBtn.disabled = !open;
    // A button that just disabled itself under the keyboard would drop
    // focus to the page; hand it back to the strip instead.
    if (focused instanceof HTMLButtonElement && focused.disabled && open) zone.focus();
  };

  // --- layout: where the bright strip sits, how long the paper is ----------

  const atEnd = (): boolean => wrap.scrollLeft + wrap.clientWidth >= wrap.scrollWidth - 32;

  const scrollToEnd = (smooth: boolean): void => {
    wrap.scrollTo({ left: wrap.scrollWidth, behavior: smooth && !reducedMotion() ? "smooth" : "auto" });
  };

  // The paper grows to hold every strip in use and the next blank one. If
  // you were already at the right-hand end it follows; if you'd scrolled
  // back to look, it leaves you there. Never mid-stroke.
  let shownInvite = -1;
  const visible = (strip: number): boolean => {
    const scale = svg.getBoundingClientRect().height / FRAME_H;
    const left = stripStart(strip) * scale;
    return left + SEGMENT * scale > wrap.scrollLeft && left < wrap.scrollLeft + wrap.clientWidth;
  };
  const revealInvite = (smooth: boolean): void => {
    const scale = svg.getBoundingClientRect().height / FRAME_H;
    const right = (stripStart(inviteStrip()) + SEGMENT + 48) * scale;
    wrap.scrollTo({
      left: Math.max(0, right - wrap.clientWidth),
      behavior: smooth && !reducedMotion() ? "smooth" : "auto",
    });
  };

  const relayout = (newMarks = 0): void => {
    const s = inviteStrip();
    // Someone took the strip you were looking at: the bright strip moves
    // one over, and the view goes with it if it was on screen.
    const followInvite = !published && drawingPointer === null && shownInvite !== s && shownInvite >= 0 && visible(shownInvite);
    shownInvite = s;
    const needed = Math.max(s, ...saved, ...claims.keys(), me?.strip ?? 0) + 1;
    const x = stripStart(s);
    invite.classList.toggle("closed", published);
    zone.classList.toggle("closed", published);
    invite.setAttribute("transform", `translate(${x} 0)`);
    zone.setAttribute("x", String(x));
    if (!current) mine.setAttribute("transform", `translate(${stripStart(me?.strip ?? s)} 0)`);
    moveCursor();

    const follow = atEnd();
    if (needed !== strips) {
      strips = needed;
      const w = totalWidth(strips);
      const pw = paperWidth(strips);
      svg.setAttribute("viewBox", `0 -18 ${w} ${FRAME_H}`);
      svg.style.aspectRatio = `${w} / ${FRAME_H}`;
      inner.style.setProperty("--paper-frac", String(pw / w));
      paper.setAttribute("width", String(pw));
      grain.setAttribute("width", String(pw));
      roller.style.transform = `translateX(${pw}px)`;
    }
    if (followInvite) revealInvite(true);
    if (newMarks > 0) {
      if (follow && drawingPointer === null) {
        scrollToEnd(true);
      } else {
        unseen += newMarks;
        newMarksBtn.textContent = `${unseen} new mark${unseen === 1 ? "" : "s"} →`;
        newMarksBtn.hidden = false;
      }
    }
  };

  newMarksBtn.addEventListener("click", () => {
    unseen = 0;
    newMarksBtn.hidden = true;
    scrollToEnd(true);
  });
  wrap.addEventListener("scroll", () => {
    if (unseen > 0 && atEnd()) {
      unseen = 0;
      newMarksBtn.hidden = true;
    }
  });

  // --- the tray --------------------------------------------------------------

  const renderSample = (): void => {
    sampleInk.replaceChildren(
      ...dryStrokeNodes(
        {
          d: brush === "wash" ? "M 30 20 Q 60 17 90 21" : "M 14 28 Q 40 6 66 18 Q 88 28 106 12",
          width: Math.min(BRUSHES[brush].max * 0.7, 22),
          brush,
          ink,
        },
        0,
        0,
        99,
      ).map(build),
    );
  };

  tray.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement;
    if (input.name === "ink" && isInk(input.value)) {
      ink = input.value;
      inkName.textContent = `${INKS[ink].name} ${INKS[ink].han}`;
    }
    if (input.name === "brush" && isBrush(input.value)) {
      brush = input.value;
      brushName.textContent = `${BRUSHES[brush].name} ${BRUSHES[brush].han}`;
      keyCursor = clampLocal(brush, keyCursor.x, keyCursor.y);
      moveCursor();
    }
    renderSample();
  });
  tray.addEventListener("submit", (event) => event.preventDefault());

  const setTool = (next: "brush" | "eraser"): void => {
    tool = next;
    eraserBtn.setAttribute("aria-pressed", String(tool === "eraser"));
    zone.classList.toggle("erasing", tool === "eraser");
    say(tool === "eraser" ? "Eraser: tap or drag over one of your wet strokes to lift it." : strokeCountMessage());
  };
  eraserBtn.addEventListener("click", () => setTool(tool === "eraser" ? "brush" : "eraser"));

  // --- the claim ---------------------------------------------------------------

  const armTimers = (idleMs: number): void => {
    deadline = Date.now() + idleMs;
    if (warnTimer) clearTimeout(warnTimer);
    if (lapseTimer) clearTimeout(lapseTimer);
    warnTimer = setTimeout(() => {
      if (me && myStrokes.length > 0)
        say("Your wet ink lifts in 15 seconds unless you keep painting or publish.");
    }, Math.max(0, idleMs - WARN_BEFORE_MS));
    lapseTimer = setTimeout(() => lapse(), idleMs + 1500);
  };

  // Your claim lapsed: the server lifted your wet ink for everyone and gave
  // the strip back. Say so before you paint again, not after.
  const lapse = (why?: string): void => {
    if (!me || published || publishing) return;
    why ??= `Your strip lapsed after ${Math.round(me.idleMs / 1000)} seconds without a stroke, and its wet ink was lifted.`;
    me = null;
    if (warnTimer) clearTimeout(warnTimer);
    if (lapseTimer) clearTimeout(lapseTimer);
    for (const s of myStrokes) s.el.remove();
    myStrokes = [];
    current = null;
    drawingPointer = null;
    updateButtons();
    prompt.classList.remove("gone");
    say(`${why} Paint again to take the next blank strip.`);
    relayout();
    updateLabel();
  };

  const ensureClaim = (): Promise<boolean> => {
    if (me) return Promise.resolve(true);
    if (claiming) return claiming;
    claiming = (async () => {
      try {
        const res = await fetch("/api/claims", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as { token: string; strip: number; idleMs: number };
        me = data;
        // If someone took the strip we were offered a moment before us, the
        // server gave us the next one: the draft moves there with us.
        const theirs = claims.get(data.strip);
        if (theirs) {
          theirs.group.remove();
          claims.delete(data.strip);
        }
        armTimers(data.idleMs);
        relayout();
        mine.setAttribute("transform", `translate(${stripStart(data.strip)} 0)`);
        updateLabel();
        return true;
      } catch (err) {
        for (const s of myStrokes) s.el.remove();
        myStrokes = [];
        current = null;
        updateButtons();
        say(`Couldn't take a strip (${(err as Error).message}). Try again in a moment.`);
        return false;
      } finally {
        claiming = null;
      }
    })();
    return claiming;
  };

  // --- wet ink up --------------------------------------------------------------

  let flushing = false;
  const flush = async (): Promise<void> => {
    if (flushing || !me) return;
    flushing = true;
    try {
      for (const s of myStrokes) {
        if (!me) break;
        const fresh = s.pts.slice(s.sent, s.sent + 100);
        if (fresh.length === 0) continue;
        const x0 = stripStart(me.strip);
        const res = await fetch("/api/wet", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            token: me.token,
            stroke: s.id,
            brush: s.brush,
            ink: s.ink,
            width: widthFor(s.brush, s.pts),
            pts: fresh.flatMap((p) => [Math.round((p.x + x0) * 10) / 10, Math.round(p.y * 10) / 10]),
          }),
        });
        if (res.status === 403) {
          lapse("Your strip lapsed while you were away, and its wet ink was lifted.");
          break;
        }
        if (res.status === 429) break; // try again on the next tick
        if (res.ok) {
          s.sent += fresh.length;
          armTimers(((await res.json()) as { idleMs: number }).idleMs);
        } else {
          s.sent = s.pts.length; // refused (e.g. too many strokes): don't retry forever
        }
      }
    } catch {
      // a network blip: the next tick tries again
    } finally {
      flushing = false;
    }
  };
  setInterval(() => {
    if (me && myStrokes.some((s) => s.sent < s.pts.length)) void flush();
  }, FLUSH_MS);

  // --- your strokes ------------------------------------------------------------

  const redraw = (s: MyStroke): void => {
    s.el.setAttribute("d", smoothPath(s.pts));
    s.el.setAttribute("stroke-width", String(widthFor(s.brush, s.pts)));
  };

  const startStroke = (x: number, y: number): MyStroke | null => {
    if (myStrokes.length >= MAX_STROKES) {
      say(`A mark holds at most ${MAX_STROKES} strokes. Lift one, or publish.`);
      return null;
    }
    const p = clampLocal(brush, x, y);
    const id = `s${(strokeSeq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const el = build(
      wetStrokeNode({ d: "", width: BRUSHES[brush].max, brush, ink }, id),
    );
    el.classList.add("mine");
    mine.appendChild(el);
    const s: MyStroke = { id, brush, ink, pts: [{ ...p, t: performance.now() }], sent: 0, el };
    myStrokes.push(s);
    redraw(s);
    prompt.classList.add("gone");
    return s;
  };

  const liftStroke = (s: MyStroke): void => {
    myStrokes = myStrokes.filter((m) => m !== s);
    s.el.remove();
    updateButtons();
    say(myStrokes.length === 0 ? "Every stroke lifted. The strip is still yours for now." : strokeCountMessage());
    if (me && s.sent > 0) {
      void fetch("/api/lift", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: me.token, stroke: s.id }),
      }).then(async (res) => {
        if (res.ok) armTimers(((await res.json()) as { idleMs: number }).idleMs);
        else if (res.status === 403) lapse();
      });
    } else {
      s.sent = s.pts.length; // never reached the server: nothing to lift there
    }
  };

  const eraseAt = (x: number, y: number): void => {
    for (const s of [...myStrokes].reverse()) {
      if (distToStroke(s.pts, x, y) <= widthFor(s.brush, s.pts) / 2 + 6) {
        liftStroke(s);
        return;
      }
    }
  };

  // Points are kept relative to the strip, measured from where the strip
  // was when the brush went down: if the claim lands one strip over, the
  // stroke moves with the claim rather than being squashed against its edge.
  let origin = 0;
  const toLocal = (event: PointerEvent): { x: number; y: number } => {
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const ctm = svg.getScreenCTM();
    const p = ctm ? pt.matrixTransform(ctm.inverse()) : pt;
    return { x: p.x - origin, y: p.y };
  };

  zone.addEventListener("pointerdown", (event) => {
    if (published || publishing || drawingPointer !== null) return;
    event.preventDefault();
    drawingPointer = event.pointerId;
    zone.setPointerCapture(event.pointerId);
    origin = stripStart(me?.strip ?? inviteStrip());
    const { x, y } = toLocal(event);
    if (tool === "eraser") {
      erasing = true;
      eraseAt(x, y);
      return;
    }
    current = startStroke(x, y);
    if (!current) {
      drawingPointer = null;
      return;
    }
    void ensureClaim();
  });

  zone.addEventListener("pointermove", (event) => {
    if (event.pointerId !== drawingPointer) return;
    const { x, y } = toLocal(event);
    if (erasing) {
      eraseAt(x, y);
      return;
    }
    if (!current || current.pts.length >= MAX_POINTS) return;
    const p = clampLocal(current.brush, x, y);
    const last = current.pts[current.pts.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) < MIN_MOVE) return;
    current.pts.push({ ...p, t: performance.now() });
    redraw(current);
  });

  const endPointer = (event: PointerEvent): void => {
    if (event.pointerId !== drawingPointer) return;
    drawingPointer = null;
    erasing = false;
    if (zone.hasPointerCapture(event.pointerId)) zone.releasePointerCapture(event.pointerId);
    if (current) {
      current = null;
      updateButtons();
      say(strokeCountMessage());
      void flush();
    }
    relayout();
  };
  zone.addEventListener("pointerup", endPointer);
  zone.addEventListener("pointercancel", endPointer);

  // --- the keyboard brush ------------------------------------------------------

  function moveCursor(): void {
    const x0 = stripStart(me?.strip ?? inviteStrip());
    cursor.setAttribute("cx", String(x0 + keyCursor.x));
    cursor.setAttribute("cy", String(keyCursor.y));
    cursor.setAttribute("r", String(Math.max(4, BRUSHES[brush].max / 2)));
  }

  zone.addEventListener("focus", () => {
    moveCursor();
    cursor.classList.add("shown");
  });
  zone.addEventListener("blur", () => cursor.classList.remove("shown"));

  zone.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? KEY_STEP * 4 : KEY_STEP;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      keyCursor = clampLocal(brush, keyCursor.x + move[0], keyCursor.y + move[1]);
      moveCursor();
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault(); // Space must not scroll the page instead
    if (published || publishing || event.repeat) return;
    if (tool === "eraser") {
      eraseAt(keyCursor.x, keyCursor.y);
      return;
    }
    const s = startStroke(keyCursor.x, keyCursor.y);
    if (!s) return;
    updateButtons();
    say(strokeCountMessage());
    void ensureClaim().then((ok) => {
      if (ok) void flush();
    });
  });

  // --- lift and publish --------------------------------------------------------

  liftBtn.addEventListener("click", () => {
    const last = myStrokes[myStrokes.length - 1];
    if (last) liftStroke(last);
  });

  publishBtn.addEventListener("click", async () => {
    if (!me || myStrokes.length === 0 || publishing) return;
    publishing = true;
    updateButtons();
    say("Publishing…");
    const claim = me;
    const x0 = stripStart(claim.strip);
    const strokes: StrokeData[] = myStrokes.map((s) => ({
      d: smoothPath(s.pts.map((p) => ({ x: p.x + x0, y: p.y }))),
      width: widthFor(s.brush, s.pts),
      brush: s.brush,
      ink: s.ink,
    }));
    try {
      const res = await fetch("/api/strokes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: claim.token, strokes }),
      });
      if (res.status === 403) {
        publishing = false;
        lapse("Your strip lapsed before it could be published, and its wet ink was lifted.");
        return;
      }
      if (!res.ok) throw new Error(await res.text());
      const mark = (await res.json()) as MarkMsg;
      published = true;
      publishing = false;
      me = null;
      if (warnTimer) clearTimeout(warnTimer);
      if (lapseTimer) clearTimeout(lapseTimer);
      mine.replaceChildren();
      myStrokes = [];
      addMark(mark, true);
      stamp(mark);
      for (const el of tray.querySelectorAll<HTMLFieldSetElement>("fieldset")) el.disabled = true;
      zone.setAttribute("tabindex", "-1");
      zone.setAttribute("aria-hidden", "true");
      cursor.classList.remove("shown");
      updateButtons();
      say(`Yours is mark ${mark.number}. It stays.`);
      relayout();
      updateLabel();
    } catch (err) {
      publishing = false;
      updateButtons();
      say(`Couldn't publish (${(err as Error).message}). Your strokes are still wet; try again.`);
    }
  });

  // The seal: drawn on your page only, never saved. It's how the page says
  // "this one is yours" without an account.
  const stamp = (mark: MarkMsg): void => {
    const x = stripStart(mark.strip) + SEGMENT - 44;
    const y = HEIGHT - 44;
    const g = document.createElementNS(SVGNS, "g");
    g.setAttribute("transform", `translate(${x} ${y})`);
    const seal = document.createElementNS(SVGNS, "g");
    seal.setAttribute("class", "seal");
    const rect = document.createElementNS(SVGNS, "rect");
    rect.setAttribute("width", "32");
    rect.setAttribute("height", "32");
    rect.setAttribute("rx", "2");
    const label = document.createElementNS(SVGNS, "text");
    label.setAttribute("x", "16");
    label.setAttribute("y", "17");
    label.textContent = String(mark.number);
    seal.append(rect, label);
    g.appendChild(seal);
    seals.appendChild(g);
  };

  // --- everyone else -----------------------------------------------------------

  const addMark = (mark: MarkMsg, own = false): void => {
    if (marksLayer.querySelector(`.mark[data-id="${mark.id}"]`)) return;
    const theirs = claims.get(mark.strip);
    if (theirs) {
      theirs.group.remove();
      claims.delete(mark.strip);
    }
    marksLayer.appendChild(build(markNode(mark, "fresh")));
    saved.add(mark.strip);
    lastId = Math.max(lastId, mark.id);
    count = Math.max(count, mark.number);
    firstAt ??= mark.createdAt;
    if (!own) relayout(1);
  };

  const claimView = (strip: number): ClaimView => {
    let view = claims.get(strip);
    if (!view) {
      const group = document.createElementNS(SVGNS, "g") as SVGGElement;
      group.setAttribute("class", "claim");
      group.dataset.strip = String(strip);
      const wash = document.createElementNS(SVGNS, "rect");
      wash.setAttribute("class", "wash");
      wash.setAttribute("x", String(stripStart(strip) + 4));
      wash.setAttribute("y", "4");
      wash.setAttribute("width", String(SEGMENT - 8));
      wash.setAttribute("height", String(HEIGHT - 8));
      group.appendChild(wash);
      claimsLayer.appendChild(group);
      view = { group, strokes: new Map() };
      claims.set(strip, view);
    }
    return view;
  };

  const addWet = (msg: WetMsg): void => {
    if (msg.strip === me?.strip || saved.has(msg.strip)) return;
    if (!isBrush(msg.brush) || !isInk(msg.ink)) return;
    const view = claimView(msg.strip);
    let wet = view.strokes.get(msg.stroke);
    if (!wet) {
      const el = build(wetStrokeNode({ d: "", width: msg.width, brush: msg.brush, ink: msg.ink }, msg.stroke));
      view.group.appendChild(el);
      wet = { brush: msg.brush, ink: msg.ink, width: msg.width, pts: [], el };
      view.strokes.set(msg.stroke, wet);
    }
    wet.pts.push(...msg.pts);
    wet.width = msg.width;
    wet.el.setAttribute("d", smoothPath(toPairs(wet.pts)));
    wet.el.setAttribute("stroke-width", String(wet.width));
  };

  const dropClaim = (strip: number, fade: boolean): void => {
    const view = claims.get(strip);
    if (!view) return;
    claims.delete(strip);
    if (fade && !reducedMotion()) {
      view.group.classList.add("lapsing");
      setTimeout(() => view.group.remove(), 450);
    } else {
      view.group.remove();
    }
  };

  // --- the stream --------------------------------------------------------------

  let source: EventSource | null = null;
  const connect = (): void => {
    source = new EventSource(`/api/events?since=${lastId}`);
    source.addEventListener("mark", (e) => {
      const mark = JSON.parse((e as MessageEvent).data) as MarkMsg;
      if (publishing && mark.strip === me?.strip) return; // the publish response draws it
      addMark(mark);
      updateLabel();
    });
    source.addEventListener("claim", (e) => {
      const { strip } = JSON.parse((e as MessageEvent).data) as { strip: number };
      if (strip === me?.strip || saved.has(strip)) return;
      claimView(strip);
      relayout();
      updateLabel();
    });
    source.addEventListener("wet", (e) => addWet(JSON.parse((e as MessageEvent).data) as WetMsg));
    source.addEventListener("lift", (e) => {
      const { strip, stroke } = JSON.parse((e as MessageEvent).data) as { strip: number; stroke: string };
      const view = claims.get(strip);
      view?.strokes.get(stroke)?.el.remove();
      view?.strokes.delete(stroke);
    });
    source.addEventListener("expire", (e) => {
      const { strip } = JSON.parse((e as MessageEvent).data) as { strip: number };
      if (strip === me?.strip) lapse();
      else dropClaim(strip, true);
      relayout();
      updateLabel();
    });
    // Sent on every (re)connect: the room as it is now. Anything we were
    // showing that isn't in it lapsed while we weren't listening.
    source.addEventListener("hello", (e) => {
      const hello = JSON.parse((e as MessageEvent).data) as {
        count: number;
        claims: { strip: number; strokes: { id: string; brush: BrushId; ink: InkId; width: number; pts: number[] }[] }[];
      };
      for (const strip of [...claims.keys()]) dropClaim(strip, false);
      if (me && !hello.claims.some((c) => c.strip === me?.strip) && !claiming)
        lapse("Your strip lapsed while you were away, and its wet ink was lifted.");
      for (const c of hello.claims) {
        if (c.strip === me?.strip || saved.has(c.strip)) continue;
        claimView(c.strip);
        for (const s of c.strokes)
          addWet({ strip: c.strip, stroke: s.id, brush: s.brush, ink: s.ink, width: s.width, pts: s.pts });
      }
      count = Math.max(count, hello.count);
      relayout();
      updateLabel();
    });
    source.addEventListener("error", () => {
      // EventSource retries on its own; if the browser gave up, start over.
      if (source?.readyState === EventSource.CLOSED) {
        source = null;
        setTimeout(connect, 3000);
      }
    });
  };

  // A phone waking up: say a lapsed claim lapsed before the next stroke.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && me && Date.now() > deadline)
      lapse("Your strip lapsed while you were away, and its wet ink was lifted.");
  });

  // --- start -------------------------------------------------------------------

  // Strips held when the page was rendered; the stream's hello fills in
  // their wet ink.
  for (const strip of (svg.dataset.held ?? "").split(",").filter(Boolean)) claimView(Number(strip));

  tray.hidden = false;
  renderSample();
  updateButtons();
  relayout();
  updateLabel();
  // Open on the bright strip, not the start of the scroll.
  revealInvite(false);
  connect();
}
