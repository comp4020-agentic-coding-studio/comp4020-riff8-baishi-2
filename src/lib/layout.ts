// Shared between the server (rendering the scroll so far, checking a mark
// stays in its strip) and the client (drawing, wet ink) so the two can never
// disagree about where a strip sits.
import { BRUSHES, type BrushId } from "./brushes";

export const HEIGHT = 480;
export const BASE_WIDTH = 1200;
export const SEGMENT = 280;
// Room past the last strip for the wooden roller the paper unrolls from.
export const ROLLER_SPACE = 48;

export function stripStart(strip: number): number {
  return BASE_WIDTH + strip * SEGMENT;
}

// The paper is always long enough to hold every strip in use plus the next
// blank one (`strips` counts them all).
export function paperWidth(strips: number): number {
  return BASE_WIDTH + strips * SEGMENT;
}

export function totalWidth(strips: number): number {
  return paperWidth(strips) + ROLLER_SPACE;
}

// The box a stroke's path coordinates must stay inside so its ink, halo
// included, never reaches past its own strip into anyone else's mark. The
// halo's reach is the brush's own spread, so a wash has to keep further from
// the edge than a fine line.
export function zoneBounds(
  strip: number,
  width: number,
  brush: BrushId = "broad",
): { minX: number; maxX: number; minY: number; maxY: number } {
  const reach = (width * BRUSHES[brush].spread) / 2;
  const x = stripStart(strip);
  return { minX: x + reach, maxX: x + SEGMENT - reach, minY: reach, maxY: HEIGHT - reach };
}

// The lowest strip that's neither saved into nor held by a live claim: where
// the next drawer goes. Expired claims free their strip, so gaps close up.
export function lowestFree(taken: Iterable<number>): number {
  const set = new Set(taken);
  let s = 0;
  while (set.has(s)) s++;
  return s;
}
