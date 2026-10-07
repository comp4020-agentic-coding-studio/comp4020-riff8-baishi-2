// Strips held by people who are drawing right now, and the wet strokes they
// hold. All in memory: a claim lost on restart costs one unpublished mark
// (docs/adr/0001-concurrent-drawers.md). The server, not the client, decides
// which strip a drawer gets and checks every wet point against it.
import { randomUUID } from "node:crypto";
import { BRUSHES, type BrushId, type InkId } from "./brushes";
import { savedStrips, MAX_STROKES } from "./db";
import { lowestFree, zoneBounds } from "./layout";
import { broadcast } from "./live";

// How long a claim survives with no new stroke, lift or wet point. A claim
// request may ask for less (never more): only ever shortening your own hold.
export const IDLE_MS = 90_000;
const MIN_IDLE_MS = 1_000;
// A cap on strips held at once, so one script can't stretch the scroll with
// a hundred empty claims.
export const MAX_CLAIMS = 32;
// Wet-ink caps: points per stroke (the client stops well short of this) and
// per request, and a per-claim request budget (a token bucket).
export const MAX_WET_POINTS = 800;
export const MAX_POINTS_PER_POST = 120;
const BUCKET_SIZE = 30;
const BUCKET_REFILL_PER_MS = 25 / 1000;

export interface WetStroke {
  id: string;
  brush: BrushId;
  ink: InkId;
  width: number;
  pts: number[]; // flat x,y pairs, absolute coordinates
}

export interface Claim {
  token: string;
  strip: number;
  idleMs: number;
  deadline: number;
  timer: ReturnType<typeof setTimeout> | null;
  strokes: Map<string, WetStroke>;
  bucket: number;
  bucketAt: number;
}

const claims: Map<string, Claim> = ((globalThis as Record<string, unknown>).__scrollClaims as
  | Map<string, Claim>
  | undefined) ?? new Map();
(globalThis as Record<string, unknown>).__scrollClaims = claims;

export function heldStrips(): number[] {
  return [...claims.values()].map((c) => c.strip);
}

export function nextFreeStrip(): number {
  return lowestFree([...savedStrips(), ...heldStrips()]);
}

function arm(claim: Claim): void {
  if (claim.timer) clearTimeout(claim.timer);
  claim.deadline = Date.now() + claim.idleMs;
  claim.timer = setTimeout(() => expire(claim), claim.idleMs);
  claim.timer.unref();
}

// A lapsed claim's wet ink is lifted for everyone and never saved; the strip
// goes back into the pool.
function expire(claim: Claim): void {
  if (claims.get(claim.token) !== claim) return;
  claims.delete(claim.token);
  broadcast("expire", { strip: claim.strip });
}

export function makeClaim(idleMs?: number): Claim | null {
  if (claims.size >= MAX_CLAIMS) return null;
  const claim: Claim = {
    token: randomUUID(),
    strip: nextFreeStrip(),
    idleMs: Math.min(IDLE_MS, Math.max(MIN_IDLE_MS, idleMs ?? IDLE_MS)),
    deadline: 0,
    timer: null,
    strokes: new Map(),
    bucket: BUCKET_SIZE,
    bucketAt: Date.now(),
  };
  claims.set(claim.token, claim);
  arm(claim);
  broadcast("claim", { strip: claim.strip });
  return claim;
}

export function findClaim(token: unknown): Claim | null {
  if (typeof token !== "string") return null;
  const claim = claims.get(token);
  return claim && claim.deadline > Date.now() ? claim : null;
}

// Publishing ends the claim without an "expire": the mark event says it all.
export function endClaim(claim: Claim): void {
  if (claim.timer) clearTimeout(claim.timer);
  claims.delete(claim.token);
}

// Spends one request from the claim's budget; false means slow down.
export function spend(claim: Claim): boolean {
  const now = Date.now();
  claim.bucket = Math.min(BUCKET_SIZE, claim.bucket + (now - claim.bucketAt) * BUCKET_REFILL_PER_MS);
  claim.bucketAt = now;
  if (claim.bucket < 1) return false;
  claim.bucket -= 1;
  return true;
}

export type WetResult =
  | { ok: true; accepted: number }
  | { ok: false; status: number; message: string };

// Adds wet points to one of the claim's strokes (starting it if new). Points
// outside the claim's strip, for this brush at this width, are dropped.
export function addWet(
  claim: Claim,
  strokeId: string,
  brush: BrushId,
  ink: InkId,
  width: number,
  points: number[],
): WetResult {
  let stroke = claim.strokes.get(strokeId);
  if (!stroke) {
    if (claim.strokes.size >= MAX_STROKES)
      return { ok: false, status: 409, message: `a mark holds at most ${MAX_STROKES} strokes` };
    stroke = { id: strokeId, brush, ink, width, pts: [] };
    claim.strokes.set(strokeId, stroke);
  }
  // A stroke keeps the brush and ink it started with.
  const b = BRUSHES[stroke.brush];
  stroke.width = Math.min(b.max, Math.max(b.min, width));
  const { minX, maxX, minY, maxY } = zoneBounds(claim.strip, stroke.width, stroke.brush);
  const fresh: number[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    const [x, y] = [points[i], points[i + 1]];
    if (x >= minX && x <= maxX && y >= minY && y <= maxY) fresh.push(x, y);
  }
  const room = MAX_WET_POINTS * 2 - stroke.pts.length;
  const accepted = fresh.slice(0, Math.max(0, room));
  stroke.pts.push(...accepted);
  arm(claim);
  if (accepted.length > 0) {
    broadcast("wet", {
      strip: claim.strip,
      stroke: strokeId,
      brush: stroke.brush,
      ink: stroke.ink,
      width: stroke.width,
      pts: accepted,
    });
  }
  return { ok: true, accepted: accepted.length / 2 };
}

export function liftWet(claim: Claim, strokeId: string): boolean {
  if (!claim.strokes.delete(strokeId)) return false;
  arm(claim);
  broadcast("lift", { strip: claim.strip, stroke: strokeId });
  return true;
}

// What a newly connected viewer needs to see the room as it is: every held
// strip and the wet ink in it. Tokens never leave the server.
export function snapshot(): { strip: number; strokes: Omit<WetStroke, never>[] }[] {
  return [...claims.values()].map((c) => ({ strip: c.strip, strokes: [...c.strokes.values()] }));
}
