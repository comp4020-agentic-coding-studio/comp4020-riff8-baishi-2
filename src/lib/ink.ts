// How a stroke turns into SVG: shared by the server render of `/` (no
// JavaScript needed to see the scroll) and the client (wet ink, your own
// mark drying in place), so a mark looks the same whichever drew it.
import { BRUSHES, HALO_ALPHA, INKS, WET_ALPHA, type BrushId, type InkId } from "./brushes";
import { HEIGHT, SEGMENT, stripStart } from "./layout";

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

// The flying-white streaks are noise seeded from the mark's own id, so every
// viewer sees exactly the same paper showing through the same stroke.
export function drySeed(markId: number, index: number): number {
  return (markId * 7919 + index * 104729) % 9973;
}

// One dry (published) stroke: a soft halo in its own ink, then the core.
export function dryStrokeNodes(
  stroke: StrokeData,
  strip: number,
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
  const nodes: SvgNode[] = [];
  const core: SvgNode = {
    tag: "path",
    attrs: { ...common, class: "core", "stroke-width": stroke.width, opacity: brush.core },
  };
  if (stroke.brush === "dry") {
    const id = `dry-${markId}-${index}`;
    nodes.push(dryFilter(id, strip, drySeed(markId, index)));
    core.attrs.filter = `url(#${id})`;
  }
  nodes.push({
    tag: "path",
    attrs: {
      ...common,
      class: "halo",
      "stroke-width": round(stroke.width * brush.spread),
      "stroke-opacity": HALO_ALPHA,
    },
  });
  nodes.push(core);
  return nodes;
}

function dryFilter(id: string, strip: number, seed: number): SvgNode {
  return {
    tag: "filter",
    attrs: {
      id,
      filterUnits: "userSpaceOnUse",
      x: stripStart(strip),
      y: 0,
      width: SEGMENT,
      height: HEIGHT,
    },
    children: [
      {
        tag: "feTurbulence",
        attrs: {
          type: "fractalNoise",
          baseFrequency: "0.012 0.55",
          numOctaves: 2,
          seed,
          result: "grain",
        },
      },
      {
        // Alpha from the noise's red channel, pushed hard so the stroke
        // breaks into streaks with paper showing between them.
        tag: "feColorMatrix",
        attrs: {
          in: "grain",
          type: "matrix",
          values: "0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  7 0 0 0 -2.6",
          result: "streaks",
        },
      },
      { tag: "feComposite", attrs: { in: "SourceGraphic", in2: "streaks", operator: "in" } },
    ],
  };
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
