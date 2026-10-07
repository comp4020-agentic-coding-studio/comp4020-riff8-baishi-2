import type { APIRoute } from "astro";
import { BRUSHES } from "../../lib/brushes";
import { endClaim, findClaim } from "../../lib/claims";
import { addMark, MAX_D_LENGTH, MAX_STROKES } from "../../lib/db";
import { brushAndInk, json, readBody, text } from "../../lib/http";
import { pathPoints, type StrokeData } from "../../lib/ink";
import { zoneBounds } from "../../lib/layout";
import { broadcast } from "../../lib/live";

// Publish: the only write path into the scroll. Every stroke of the mark
// comes in one request and is validated here, not trusted from the client
// (CLAUDE.md); one bad stroke refuses the whole mark and nothing is written.
export const POST: APIRoute = async ({ request }) => {
  const body = await readBody(request, MAX_STROKES * (MAX_D_LENGTH + 200) + 1024);
  if (body instanceof Response) return body;

  const claim = findClaim(body.token);
  if (!claim) return text("you hold no strip (or your claim lapsed), so there's nowhere to publish", 403);

  const raw = body.strokes;
  if (!Array.isArray(raw) || raw.length === 0)
    return text("a mark needs at least one stroke", 400);
  if (raw.length > MAX_STROKES) return text(`a mark holds at most ${MAX_STROKES} strokes`, 400);

  const strokes: StrokeData[] = [];
  for (const [i, s] of raw.entries()) {
    if (typeof s !== "object" || s === null)
      return text(`stroke ${i + 1}: expected an object`, 400);
    const { d, width } = s as Record<string, unknown>;
    const tools = brushAndInk(s as Record<string, unknown>);
    if (tools instanceof Response) return tools;
    if (typeof d !== "string" || d.length === 0 || d.length > MAX_D_LENGTH)
      return text(`stroke ${i + 1}: path is missing, empty or too long`, 400);
    const brush = BRUSHES[tools.brush];
    if (typeof width !== "number" || !Number.isFinite(width) || width < brush.min || width > brush.max)
      return text(`stroke ${i + 1}: width out of range for this brush`, 400);
    if (pathPoints(d) === null)
      return text(`stroke ${i + 1}: path must be M, then L and Q segments only`, 400);
    strokes.push({ d, width, ...tools });
  }

  // A stroke painted outside its own strip would cover someone else's mark:
  // erasing by other means. The halo counts, at this brush's own spread.
  for (const [i, s] of strokes.entries()) {
    const { minX, maxX, minY, maxY } = zoneBounds(claim.strip, s.width, s.brush);
    const points = pathPoints(s.d) ?? [];
    if (!points.every((p) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY))
      return text(`stroke ${i + 1} reaches outside your strip`, 409);
  }

  // Nothing awaits between the claim check and the insert, so the claim
  // can't lapse or be handed on in between.
  const mark = addMark(claim.strip, strokes);
  endClaim(claim);
  broadcast("mark", mark, mark.id);
  return json(mark, 201);
};
