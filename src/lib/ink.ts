// How a stroke turns into SVG: shared by the server render of `/` (no
// JavaScript needed to see the scroll) and the client (wet ink, your own
// mark drying in place), so a mark looks the same whichever drew it.
import { BRUSHES, HALO_ALPHA, INKS, WET_ALPHA, type BrushId, type InkId } from "./brushes";

export interface StrokeData {
  d: string;
  width: number;
  brush: BrushId;
  ink: InkId;
}

export interface Point {
  x: number;
  y: number;
}

// A tiny element description both sides can build from: the server turns it
// into markup, the client into DOM nodes.
export interface SvgNode {
  tag: string;
  attrs: Record<string, string | number>;
  children?: SvgNode[];
}

const round = (n: number): number => Math.round(n * 10) / 10;

// Turns a recorded polyline into a smooth curve: a quadratic segment per
// point, aimed at the midpoint to the next one, is the standard trick for
// smoothing freehand input without a spline library. A single point gets a
// zero-length "L" — a bare "M" has no paintable geometry in SVG.
export function smoothPath(points: Point[]): string {
  if (points.length === 0) return "";
  const [first] = points;
  if (points.length === 1)
    return `M ${round(first.x)} ${round(first.y)} L ${round(first.x)} ${round(first.y)}`;
  let d = `M ${round(first.x)} ${round(first.y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const mx = (points[i].x + points[i + 1].x) / 2;
    const my = (points[i].y + points[i + 1].y) / 2;
    d += ` Q ${round(points[i].x)} ${round(points[i].y)} ${round(mx)} ${round(my)}`;
  }
  const last = points[points.length - 1];
  d += ` L ${round(last.x)} ${round(last.y)}`;
  return d;
}

// Every point a path names, control points included, or null if it isn't the
// one shape smoothPath emits: a moveto, then any run of L and Q segments. A
// quadratic curve never leaves the hull of its control points, so bounding
// these bounds the ink.
export function pathPoints(d: string): Point[] | null {
  const tokens = d.trim().split(/\s+/);
  const arity: Record<string, number> = { M: 2, L: 2, Q: 4 };
  const points: Point[] = [];
  for (let i = 0; i < tokens.length; ) {
    const command = tokens[i];
    const n = arity[command];
    if (n === undefined || (command === "M") !== (i === 0)) return null;
    const args = tokens.slice(i + 1, i + 1 + n).map(Number);
    if (args.length !== n || !args.every(Number.isFinite)) return null;
    for (let j = 0; j < n; j += 2) points.push({ x: args[j], y: args[j + 1] });
    i += 1 + n;
  }
  return points;
}

// The flying-white streaks come from the mark's own id, so every viewer
// sees exactly the same paper showing through the same stroke.
export function drySeed(markId: number, index: number): number {
  return (markId * 7919 + index * 104729) % 9973;
}

// A small seeded generator (mulberry32): same seed, same bristles.
function seeded(seed: number): () => number {
  let a = seed + 0x6d2b79f5;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The wash's soft bleed is a blur of this many user units: zoneBounds
// allows for it through the brush's spread (see brushes.ts).
export const BLEED = 3;

// One dry (published) stroke: a soft halo in its own ink, then the core.
export function dryStrokeNodes(
  stroke: StrokeData,
  _strip: number,
  markId: number,
  index: number,
): SvgNode[] {
  const brush = BRUSHES[stroke.brush];
  const hex = INKS[stroke.ink].hex;
  const common = {
    d: stroke.d,
    fill: "none",
    stroke: hex,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "data-brush": stroke.brush,
    "data-ink": stroke.ink,
  };
  const halo: SvgNode = {
    tag: "path",
    attrs: {
      ...common,
      class: "halo",
      "stroke-width": round(stroke.width * brush.halo),
      "stroke-opacity": HALO_ALPHA,
    },
  };
  if (stroke.brush === "wash") halo.attrs.filter = "url(#bleed)";
  if (stroke.brush !== "dry") {
    return [
      halo,
      { tag: "path", attrs: { ...common, class: "core", "stroke-width": stroke.width, opacity: brush.core } },
    ];
  }
  // Flying white: the brush runs dry, its bristles part, and paper shows
  // through in streaks along the stroke. A bundle of thin bristle lines,
  // each offset a little and broken by its own dashes.
  const rand = seeded(drySeed(markId, index));
  const bristles: SvgNode[] = [];
  const n = 6;
  for (let i = 0; i < n; i++) {
    const offset = ((i + 0.5) / n - 0.5) * stroke.width * 0.8;
    const dashes = Array.from({ length: 6 }, (_, j) =>
      round(j % 2 === 0 ? 14 + rand() * 60 : 2 + rand() * 12),
    ).join(" ");
    bristles.push({
      tag: "path",
      attrs: {
        ...common,
        class: i === 0 ? "core" : "core bristle",
        "stroke-width": round(Math.max(1, stroke.width / 4.5)),
        "stroke-dasharray": dashes,
        "stroke-dashoffset": round(rand() * 80),
        transform: `translate(${round(offset * 0.7)} ${round(offset)})`,
        opacity: brush.core,
      },
    });
  }
  return [halo, ...bristles];
}

// A whole published mark, one group per mark, so it can dry as one.
export function markNode(
  mark: { id: number; strip: number; strokes: StrokeData[] },
  extraClass = "",
): SvgNode {
  return {
    tag: "g",
    attrs: {
      class: `mark${extraClass ? ` ${extraClass}` : ""}`,
      "data-id": mark.id,
      "data-strip": mark.strip,
    },
    children: mark.strokes.flatMap((s, i) => dryStrokeNodes(s, mark.strip, mark.id, i)),
  };
}

// Wet ink: lighter, softened, no halo. Never saved.
export function wetStrokeNode(stroke: StrokeData, strokeId: string): SvgNode {
  return {
    tag: "path",
    attrs: {
      class: "wet",
      "data-stroke": strokeId,
      d: stroke.d,
      fill: "none",
      stroke: INKS[stroke.ink].hex,
      "stroke-width": stroke.width,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      opacity: WET_ALPHA,
      filter: "url(#wet-soft)",
    },
  };
}

const escapeAttr = (v: string | number): string =>
  String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export function toMarkup(node: SvgNode): string {
  const attrs = Object.entries(node.attrs)
    .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
    .join("");
  const children = (node.children ?? []).map(toMarkup).join("");
  return `<${node.tag}${attrs}>${children}</${node.tag}>`;
}
