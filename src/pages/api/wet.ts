import type { APIRoute } from "astro";
import { addWet, findClaim, MAX_POINTS_PER_POST, spend } from "../../lib/claims";
import { brushAndInk, json, readBody, STROKE_ID, text } from "../../lib/http";

// Wet ink on its way to everyone else: a small batch of points for one of
// the claim's strokes. Validated like real ink — no claim, no ink; points
// outside the claim's strip are dropped — and never saved.
export const POST: APIRoute = async ({ request }) => {
  const body = await readBody(request, 8 * 1024);
  if (body instanceof Response) return body;

  const claim = findClaim(body.token);
  if (!claim) return text("you hold no strip (or your claim lapsed)", 403);
  if (!spend(claim)) return text("too much wet ink at once; slow down", 429);

  const tools = brushAndInk(body);
  if (tools instanceof Response) return tools;
  const { stroke, width, pts } = body;
  if (typeof stroke !== "string" || !STROKE_ID.test(stroke))
    return text("stroke id must be 1-16 lowercase letters or digits", 400);
  if (typeof width !== "number" || !Number.isFinite(width))
    return text("expected a numeric width", 400);
  if (
    !Array.isArray(pts) ||
    pts.length % 2 !== 0 ||
    pts.length > MAX_POINTS_PER_POST * 2 ||
    !pts.every((n) => typeof n === "number" && Number.isFinite(n))
  )
    return text(`expected up to ${MAX_POINTS_PER_POST} x,y pairs`, 400);

  const result = addWet(claim, stroke, tools.brush, tools.ink, width, pts as number[]);
  if (!result.ok) return text(result.message, result.status);
  return json({ accepted: result.accepted, idleMs: claim.idleMs });
};
